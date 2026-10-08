"""Import selected public StatsBomb JSONs without cloning the data repository.

Example: python -m app.services.statsbomb_importer --competition 43 --season 106
         --match-ids 3869685
License/attribution: https://github.com/statsbomb/open-data
"""
import argparse
import hashlib
import json
from datetime import datetime

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from sqlalchemy import delete, select, text

from app.db import SessionLocal
from app.db.models import (
    CollectionState, Competition, Corner, DataSource, DataSourceRecord,
    Event, EventPosition, EventType, Goal, Lineup, Match, Pass, Player,
    Season, Shot, Team,
)
from app.services.data_sync import checkpoint, entity, ingestion_session, upsert

SOURCE = DataSource.STATSBOMB
BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
TYPE_MAP = {
    "Shot": EventType.SHOT, "Pass": EventType.PASS, "Dribble": EventType.DRIBBLE,
    "Duel": EventType.DUEL, "Interception": EventType.INTERCEPTION,
    "Foul Committed": EventType.FOUL, "Foul Won": EventType.FOUL,
    "Substitution": EventType.SUBSTITUTION, "Bad Behaviour": EventType.CARD,
}


def normalized_location(location):
    if not location or len(location) < 2:
        return None
    # StatsBomb: 120x80, attack-relative. Scout pitch: 100x100.
    x, y = float(location[0]), float(location[1])
    if not (0 <= x <= 120 and 0 <= y <= 80):
        raise ValueError("Coordenada StatsBomb fora do campo.")
    return x / 1.2, y / 0.8


def ingest_match(db, raw_match, lineups, events):
    if not events or not lineups:
        raise ValueError("Partida sem eventos ou escalacao.")
    # Avoid exhausting a free Neon database with an accidental large import.
    if db.bind.dialect.name == "postgresql":
        size = db.scalar(text("SELECT pg_database_size(current_database())"))
        if size > 400 * 1024 * 1024:
            raise RuntimeError("Banco acima de 400 MiB; revise armazenamento antes de importar eventos.")
    comp_raw, season_raw = raw_match["competition"], raw_match["season"]
    comp = entity(db, Competition, SOURCE, comp_raw["competition_id"],
                  name=comp_raw["competition_name"], country=comp_raw.get("country_name"), type="unknown")
    season = upsert(db, Season, {"competition_id": comp.id, "name": season_raw["season_name"]},
                    {"data_source": SOURCE, "current": False})
    teams = {}
    for side in ("home", "away"):
        raw = raw_match[f"{side}_team"]
        teams[raw[f"{side}_team_id"]] = entity(
            db, Team, SOURCE, raw[f"{side}_team_id"], name=raw[f"{side}_team_name"],
            country=(raw.get("country") or {}).get("name"),
        )
    match = entity(
        db, Match, SOURCE, raw_match["match_id"], season_id=season.id,
        home_team_id=teams[raw_match["home_team"]["home_team_id"]].id,
        away_team_id=teams[raw_match["away_team"]["away_team_id"]].id,
        kickoff_time=datetime.fromisoformat(raw_match["match_date"] + "T" + raw_match["kick_off"]),
        home_score=raw_match["home_score"], away_score=raw_match["away_score"],
        status="finished", matchday=raw_match.get("match_week"),
        round_name=(raw_match.get("competition_stage") or {}).get("name"),
    )
    players = {}
    for lineup in lineups:
        for raw in lineup["lineup"]:
            players[raw["player_id"]] = entity(
                db, Player, SOURCE, raw["player_id"], last_name=raw["player_name"],
                display_name=raw.get("player_nickname") or raw["player_name"],
                nationality=(raw.get("country") or {}).get("name"),
            )
    starters = {
        (event["team"]["id"], player["player"]["id"])
        for event in events if event["type"]["name"] == "Starting XI"
        for player in event["tactics"]["lineup"]
    }
    # Event subtypes have ON DELETE CASCADE. Replacement and checkpoint commit
    # together, so a corrected source cannot leave half-updated events.
    db.execute(delete(Event).where(Event.match_id == match.id, Event.data_source == SOURCE))
    db.execute(delete(Lineup).where(Lineup.match_id == match.id))
    for lineup in lineups:
        for raw in lineup["lineup"]:
            positions = raw.get("positions") or []
            if not positions:
                continue
            db.add(Lineup(
                match_id=match.id, team_id=teams[lineup["team_id"]].id,
                player_id=players[raw["player_id"]].id,
                shirt_number=raw.get("jersey_number"),
                is_starter=(lineup["team_id"], raw["player_id"]) in starters,
                position=positions[0].get("position"),
                # Minutes need period/stoppage-time treatment; don't invent 90.
                minutes_played=None,
            ))
    count, shots, passes = 0, 0, 0
    ids = set()
    for raw in events:
        if raw["id"] in ids:
            raise ValueError("ID de evento duplicado na fonte.")
        ids.add(raw["id"])
        # Penalty shootouts are not part of match goals/xG in our analytics.
        if raw["period"] == 5:
            continue
        name = raw["type"]["name"]
        subtype = raw.get("shot") or raw.get("pass") or {}
        event = Event(
            external_id=raw["id"], data_source=SOURCE, match_id=match.id,
            team_id=teams[raw["team"]["id"]].id,
            player_id=players[raw["player"]["id"]].id if raw.get("player") else None,
            type=TYPE_MAP.get(name, EventType.OTHER),
            minute=raw["minute"], second=raw["second"], period=str(raw["period"]),
            outcome=(subtype.get("outcome") or {}).get("name"),
            details=raw,
        )
        location = normalized_location(raw.get("location"))
        end = normalized_location(subtype.get("end_location"))
        if location:
            event.position = EventPosition(x=location[0], y=location[1],
                                           end_x=end[0] if end else None, end_y=end[1] if end else None)
        if name == "Shot":
            outcome = (subtype.get("outcome") or {}).get("name")
            event.shot = Shot(
                xg=subtype.get("statsbomb_xg"), is_goal=outcome == "Goal",
                on_target=outcome in ("Goal", "Saved", "Saved to Post"),
                body_part=(subtype.get("body_part") or {}).get("name"),
                shot_type=(subtype.get("type") or {}).get("name"),
                situation=(raw.get("play_pattern") or {}).get("name"),
            )
            if outcome == "Goal":
                event.goal = Goal(scorer_player_id=event.player_id,
                                  is_penalty=(subtype.get("type") or {}).get("name") == "Penalty")
            shots += 1
        if name == "Pass":
            recipient = subtype.get("recipient")
            event.pass_ = Pass(
                length=subtype.get("length"), angle=subtype.get("angle"),
                is_key_pass=bool(subtype.get("shot_assist")),
                is_assist=bool(subtype.get("goal_assist")),
                is_through_ball=(subtype.get("technique") or {}).get("name") == "Through Ball",
                height=(subtype.get("height") or {}).get("name"),
                pass_recipient_id=players[recipient["id"]].id if recipient else None,
            )
            if (subtype.get("type") or {}).get("name") == "Corner":
                event.corner = Corner(outcome=event.outcome or "Complete")
            passes += 1
        db.add(event)
        count += 1
    summary = {
        "events": count, "shots": shots, "passes": passes,
        "source_updated_at": raw_match.get("last_updated"),
        "sha256": hashlib.sha256(json.dumps(events, sort_keys=True).encode()).hexdigest(),
        "coordinates": "100x100, attack-relative; raw coordinates in event.details",
    }
    checkpoint(db, SOURCE.value, str(raw_match["match_id"]), "success", summary)
    upsert(db, DataSourceRecord, {"name": SOURCE}, {
        "description": "StatsBomb Open Data; selected historical matches; attribution required.",
        "last_import_at": datetime.utcnow(),
    })
    return summary


def import_selected(competition_id, season_id, match_ids, force=False, factory=SessionLocal):
    if not 1 <= len(set(match_ids)) <= 5:
        raise ValueError("Importe de 1 a 5 partidas por execucao no plano gratuito.")
    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=Retry(
        total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504],
    )))

    def get(path):
        response = session.get(f"{BASE}/{path}", timeout=45)
        response.raise_for_status()
        return response.json()

    summary = {}
    try:
        matches = {m["match_id"]: m for m in get(f"matches/{competition_id}/{season_id}.json")}
        for match_id in dict.fromkeys(match_ids):
            raw = matches[match_id]
            with factory() as db:
                state = db.scalar(select(CollectionState).where(
                    CollectionState.provider == SOURCE.value, CollectionState.resource == str(match_id)))
                unchanged = (state and state.status == "success" and raw.get("last_updated")
                             and state.summary.get("source_updated_at") == raw["last_updated"])
            if unchanged and not force:
                summary[match_id] = {"status": "unchanged"}
                continue
            events, lineups = get(f"events/{match_id}.json"), get(f"lineups/{match_id}.json")
            with ingestion_session(factory) as db:
                summary[match_id] = ingest_match(db, raw, lineups, events)
    finally:
        session.close()
    return summary


def print_counts(factory=SessionLocal):
    rows = [
        ("competition", "SELECT count(*) FROM competition"),
        ("team", "SELECT count(*) FROM team"),
        ("match", "SELECT count(*) FROM match"),
        ("event", "SELECT count(*) FROM event"),
        ("shot", "SELECT count(*) FROM shot"),
        ("pass", "SELECT count(*) FROM pass"),
    ]
    print("--- counts:")
    with factory() as db:
        for label, sql in rows:
            print(f"  {label}: {db.scalar(text(sql))}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--competition", type=int, required=True,
                        help="ID da competição no StatsBomb (ex: 43 = Copa do Mundo)")
    parser.add_argument("--season", type=int, required=True,
                        help="ID da temporada (ex: 106 = 2022)")
    parser.add_argument("--match-ids", nargs="+", type=int, required=True,
                        help="IDs das partidas (1 a 5 por execução no plano gratuito)")
    parser.add_argument("--force", action="store_true",
                        help="Força reimportação mesmo que a fonte não tenha sido atualizada")
    parser.add_argument("--counts", action="store_true",
                        help="Imprime contagens finais do banco após importação")
    args = parser.parse_args()
    try:
        res = import_selected(args.competition, args.season, args.match_ids, args.force)
        print(json.dumps(res, indent=2))
        if args.counts:
            print_counts()
    except Exception as exc:
        print(f"Importacao StatsBomb falhou: {type(exc).__name__}. Nenhum lote parcial foi gravado.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
