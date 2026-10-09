"""football-data.org -> validation -> transactional PostgreSQL upserts.

Run with: python -m app.services.data_sync --competitions BSA
No files, paid endpoints, background threads or fabricated advanced metrics.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
import json
import time

import requests
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.db.models import (
    CollectionState, Competition, DataSource, DataSourceRecord, Match,
    Player, Season, Stadium, Standing, Team, TeamStatistics,
)

SOURCE = DataSource.FOOTBALL_DATA
BASE_URL = "https://api.football-data.org/v4"
STATUS_MAP = {
    "SCHEDULED": "scheduled", "TIMED": "scheduled",
    "LIVE": "in_progress", "IN_PLAY": "in_progress", "PAUSED": "in_progress",
    "FINISHED": "finished", "AWARDED": "finished", "CANCELLED": "cancelled",
    "POSTPONED": "postponed", "SUSPENDED": "suspended",
}


class FootballDataClient:
    def __init__(self, token: str, session=None, sleep=time.sleep, clock=time.monotonic):
        if not token:
            raise ValueError("Configure FOOTBALL_DATA_TOKEN no .env.")
        self.session = session or requests.Session()
        self.session.headers.update({"X-Auth-Token": token, "Accept": "application/json"})
        self.sleep, self.clock = sleep, clock
        self.last_request = None
        self.request_count = 0

    def close(self):
        self.session.close()

    def get(self, path, params=None):
        for attempt in range(4):
            # Proactive pacing works even when the provider omits quota headers.
            if self.last_request is not None:
                self.sleep(max(0, 6.2 - (self.clock() - self.last_request)))
            self.last_request = self.clock()
            self.request_count += 1
            try:
                response = self.session.get(f"{BASE_URL}/{path}", params=params, timeout=30)
            except (requests.Timeout, requests.ConnectionError):
                if attempt == 3:
                    raise RuntimeError("Falha de rede na football-data.org.") from None
                self.sleep(2 ** attempt)
                continue
            if response.status_code == 200:
                return response.json()
            if response.status_code == 429 or response.status_code >= 500:
                delay = response.headers.get("Retry-After", response.headers.get("X-RequestCounter-Reset", "60"))
                try:
                    delay = min(120, max(1, float(delay)))
                except ValueError:
                    delay = 60
                self.sleep(delay if response.status_code == 429 else 2 ** attempt)
                continue
            # Do not log headers, credentials or response bodies.
            raise RuntimeError(f"football-data.org: HTTP {response.status_code} em {path}.")
        raise RuntimeError(f"Limite de tentativas atingido em {path}.")

    def fetch_competition(self, code):
        competition = self.get(f"competitions/{code}")
        season_year = date.fromisoformat(competition["currentSeason"]["startDate"]).year
        params = {"season": season_year}
        # Whole current-season fixture list is small and catches postponed games
        # and corrections outside a rolling date window.
        return {
            "competition": competition,
            "teams": self.get(f"competitions/{code}/teams", params),
            "matches": self.get(f"competitions/{code}/matches", params),
            "standings": self.get(f"competitions/{code}/standings", params),
        }


def upsert(db: Session, model, keys: dict, values: dict):
    if not keys or any(value is None for value in keys.values()):
        raise ValueError("Upsert exige uma identidade completa.")
    now = datetime.utcnow()
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    statement = insert(model).values(**keys, **values, created_at=now, updated_at=now)
    statement = statement.on_conflict_do_update(
        index_elements=list(keys), set_={**values, "updated_at": now}
    ).returning(model)
    return db.scalars(statement, execution_options={"populate_existing": True}).one()


def entity(db, model, source, external_id, **values):
    if external_id is None:
        raise ValueError(f"{model.__name__} sem ID do provedor.")
    return upsert(db, model, {"data_source": source, "external_id": str(external_id)}, values)


def upsert_entities(db, model, rows):
    """Batch rows whose generated IDs are not needed by this import."""
    if not rows:
        return
    # A player may appear on two squads after a transfer.
    unique = {(row["data_source"], row["external_id"]): row for row in rows}
    rows = list(unique.values())
    now = datetime.utcnow()
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    for start in range(0, len(rows), 100):
        batch = [{**row, "created_at": now, "updated_at": now} for row in rows[start:start + 100]]
        stmt = insert(model).values(batch)
        updates = {key: getattr(stmt.excluded, key) for key in batch[0]
                   if key not in ("data_source", "external_id", "created_at")}
        db.execute(stmt.on_conflict_do_update(
            index_elements=["data_source", "external_id"], set_=updates))


@contextmanager
def ingestion_session(factory=SessionLocal):
    with factory() as db, db.begin():
        if db.bind.dialect.name == "postgresql":
            # Transaction-scoped lock works with Neon's transaction pooler.
            locked = db.scalar(text("SELECT pg_try_advisory_xact_lock(73626819)"))
            if not locked:
                raise RuntimeError("Outra importacao esta gravando; tente novamente depois.")
        yield db


def checkpoint(db, provider, resource, status, summary):
    values = {"status": status, "summary": summary}
    if status == "success":
        values["last_success_at"] = datetime.utcnow()
    upsert(db, CollectionState, {"provider": provider, "resource": resource}, values)


def season_for(db, comp, raw, current_id):
    return upsert(db, Season, {"competition_id": comp.id, "name": str(raw["id"])}, {
        "start_date": date.fromisoformat(raw["startDate"]),
        "end_date": date.fromisoformat(raw["endDate"]) if raw.get("endDate") else None,
        "current": raw["id"] == current_id, "data_source": SOURCE,
    })


def ingest_competition(db, payload):
    raw = payload["competition"]
    current = raw["currentSeason"]
    for name in ("teams", "standings"):
        if payload[name].get("season", {}).get("id") != current["id"]:
            raise ValueError(f"Temporada divergente em {name}; nada sera gravado.")
    comp = entity(db, Competition, SOURCE, raw["id"], name=raw["name"], code=raw["code"],
                  country=(raw.get("area") or {}).get("name"), type=raw["type"].lower())
    seasons = {}
    season = season_for(db, comp, current, current["id"])
    seasons[current["id"]] = season
    db.query(Season).filter(Season.competition_id == comp.id, Season.id != season.id).update(
        {"current": False}, synchronize_session=False
    )
    teams = {}
    player_rows = []

    def team_for(team):
        external_id = team["id"]
        if external_id is None or not team.get("name"):
            raise ValueError("Partida com time ainda indefinido.")
        if external_id in teams:
            return teams[external_id]
        values = {"name": team["name"]}
        for key, target in (("shortName", "short_name"), ("tla", "code"), ("crest", "logo_url"), ("founded", "founded")):
            if team.get(key) is not None:
                values[target] = team[key]
        if team.get("area"):
            values["country"] = team["area"]["name"]
        if isinstance(team.get("venue"), str) and team["venue"]:
            stadium = entity(db, Stadium, SOURCE, f"team:{external_id}", name=team["venue"],
                             country=values.get("country"))
            values["stadium_id"] = stadium.id
        result = entity(db, Team, SOURCE, external_id, **values)
        teams[external_id] = result
        for player in team.get("squad") or []:
            if player.get("id") is None:
                raise ValueError("Jogador sem ID do provedor.")
            player_rows.append({
                "data_source": SOURCE, "external_id": str(player["id"]),
                "last_name": player["name"], "display_name": player["name"],
                "position": player.get("position"), "nationality": player.get("nationality"),
                "date_of_birth": date.fromisoformat(player["dateOfBirth"]) if player.get("dateOfBirth") else None,
                # Clube atual — habilita /players?team_id= (elenco na tela de time).
                "team_id": result.id,
            })
        return result

    for raw_team in payload["teams"]["teams"]:
        team_for(raw_team)
    matches = 0
    unresolved = 0
    seen = set()
    match_rows = []
    for match in payload["matches"]["matches"]:
        if match.get("id") is None:
            raise ValueError("Partida sem ID do provedor.")
        if match["id"] in seen:
            continue
        seen.add(match["id"])
        if any(match[side].get("id") is None or not match[side].get("name") for side in ("homeTeam", "awayTeam")):
            unresolved += 1
            continue
        match_season = match["season"]
        if match_season["id"] not in seasons:
            seasons[match_season["id"]] = season_for(db, comp, match_season, current["id"])
        home, away = team_for(match["homeTeam"]), team_for(match["awayTeam"])
        score = match.get("score") or {}
        full, half = score.get("fullTime") or {}, score.get("halfTime") or {}
        kickoff = datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00"))
        match_rows.append(dict(data_source=SOURCE, external_id=str(match["id"]),
               season_id=seasons[match_season["id"]].id,
               home_team_id=home.id, away_team_id=away.id,
               kickoff_time=kickoff.astimezone(timezone.utc).replace(tzinfo=None),
               status=STATUS_MAP.get(match["status"], match["status"].lower()),
               round_name=match.get("stage"), matchday=match.get("matchday"),
               home_score=full.get("home"), away_score=full.get("away"),
               home_ht_score=half.get("home"), away_ht_score=half.get("away")))
        matches += 1
    standings = 0
    # Snapshot replacement is transactional; old group positions cannot linger.
    db.query(Standing).filter(Standing.season_id == season.id).delete(synchronize_session=False)
    db.query(TeamStatistics).filter(TeamStatistics.season_id == season.id).delete(synchronize_session=False)
    for block in payload["standings"]["standings"]:
        if block["type"] != "TOTAL":
            continue
        for row in block["table"]:
            team = team_for(row["team"])
            values = {target: row.get(key) for key, target in (
                ("position", "position"), ("playedGames", "played"), ("won", "won"),
                ("draw", "draw"), ("lost", "lost"), ("points", "points"),
                ("goalsFor", "goals_for"), ("goalsAgainst", "goals_against"),
                ("goalDifference", "goal_difference"),
            )}
            upsert(db, Standing, {"season_id": season.id, "team_id": team.id,
                                  "group_name": block.get("group") or ""}, values)
            w = int(row.get("won") or 0); d = int(row.get("draw") or 0); l = int(row.get("lost") or 0)
            mp = w + d + l
            gf = float(row.get("goalsFor") or 0); ga = float(row.get("goalsAgainst") or 0)
            pts = float(row.get("points") or 0)
            # Derive per-90 estimates assuming 90 min standard match (sem extra time)
            minutes_est = max(mp, 1) * 90.0
            upsert(db, TeamStatistics, {"team_id": team.id, "season_id": season.id, "scope": "overall"}, {
                "matches_played": mp, "wins": w, "draws": d, "losses": l,
                "goals_for": gf, "goals_against": ga,
                "xg_per_90": (gf * 90.0) / minutes_est if mp else 0.0,
                "xga_per_90": (ga * 90.0) / minutes_est if mp else 0.0,
                "goals_conceded_per_90": (ga * 90.0) / minutes_est if mp else 0.0,
                "points_per_game": pts / mp if mp else 0.0,
                "recent_form": [],
            })
            standings += 1
    upsert_entities(db, Player, player_rows)
    upsert_entities(db, Match, match_rows)
    summary = {"teams": len(teams), "matches": matches, "standings": standings,
               "unresolved_matches": unresolved, "season_id": season.id}
    checkpoint(db, SOURCE.value, comp.code, "success", summary)
    upsert(db, DataSourceRecord, {"name": SOURCE}, {
        "description": "football-data.org: fixtures and standings; not advanced event data.",
        "last_import_at": datetime.utcnow(),
    })
    return summary


def sync_football_data_for_competitions(codes=None, *, client=None, factory=SessionLocal):
    settings = get_settings()
    codes = list(dict.fromkeys(c.strip().upper() for c in
                 (codes or settings.SYNC_COMPETITIONS.split(",")) if c.strip()))
    if not codes or len(codes) > 12 or any(not c.isalnum() for c in codes):
        raise ValueError("Informe de 1 a 12 codigos de competicao.")
    owned_client = client is None
    client = client or FootballDataClient(settings.FOOTBALL_DATA_TOKEN)
    summary = {}
    try:
        for code in codes:
            try:
                payload = client.fetch_competition(code)
                # Fetch before opening a DB transaction; rate-limit waits don't
                # keep Neon compute/connections busy.
                with ingestion_session(factory) as db:
                    summary[code] = ingest_competition(db, payload)
            except Exception as exc:
                error = type(exc).__name__
                summary[code] = {"error": error}
                with ingestion_session(factory) as db:
                    checkpoint(db, SOURCE.value, code, "failed", {"error": error})
                raise RuntimeError(f"Falha na coleta {code} ({error}); lote revertido.") from None
    finally:
        if owned_client:
            client.close()
    return summary


def print_counts(factory=SessionLocal):
    rows = [
        ("competition", "SELECT count(*) FROM competition"),
        ("team", "SELECT count(*) FROM team"),
        ("match", "SELECT count(*) FROM match"),
        ("player", "SELECT count(*) FROM player"),
        ("standing", "SELECT count(*) FROM standing"),
    ]
    print("--- counts:")
    with factory() as db:
        for label, sql in rows:
            print(f"  {label}: {db.scalar(text(sql))}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competitions", nargs="+")
    parser.add_argument("--scope", choices=["full"], default=None,
                        help="(ignorado, mantido para compatibilidade)")
    parser.add_argument("--counts", action="store_true",
                        help="Imprime contagens finais do banco após sincronia")
    args = parser.parse_args()
    try:
        print(json.dumps(sync_football_data_for_competitions(args.competitions), indent=2))
        if args.counts:
            print_counts()
    except Exception as exc:
        print(f"Coleta interrompida: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
