"""Sincronização de dados da Understat (understat.com) para o ScoutVision.

Usa exclusivamente a biblioteca `understat` (>=0.1.14), que consome os endpoints
JSON atuais do site (getLeagueData / getMatchData / getPlayerData). Nenhuma
estatística é inventada: tudo o que é gravado vem da resposta da Understat, e o
que não existe na fonte permanece nulo/zero com a origem registrada em
`data_source = understat`.

O que é coletado por liga/temporada:
- competição e temporada (tabela da liga: W/D/L, gols, xG, xGA, PPDA, deep)
- times e jogadores (agregados de temporada)
- partidas (resultados e jogos futuros)
- chutes por partida com coordenadas (X/Y 0..1, ataque para a direita), xG,
  situação, parte do corpo e resultado
- eventos de gol (com assistência quando o nome é resolvível)

Execução:
    python -m app.services.understat_sync --leagues epl --season 2026
    python -m app.services.understat_sync --leagues epl --season 2026 --shots-only
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any, Iterable

try:
    import aiohttp
    from app.vendor.understat import Understat
except Exception as exc:  # pragma: no cover - dependência opcional
    print(f"Dependências da Understat não instaladas: {exc}")
    raise

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, selectinload

from app.db import SessionLocal
from app.db.models import (
    CollectionState,
    Competition,
    DataSource,
    Event,
    EventPosition,
    EventType,
    Goal,
    Match,
    Player,
    PlayerStatistics,
    Season,
    Shot,
    Team,
    TeamMatchStatistics,
    TeamStatistics,
)

SOURCE = DataSource.UNDERSTAT

UNDERSTAT_LEAGUES = {
    "epl": {"code": "PL", "name": "Premier League", "country": "England"},
    "la_liga": {"code": "PD", "name": "La Liga", "country": "Spain"},
    "bundesliga": {"code": "BL1", "name": "Bundesliga", "country": "Germany"},
    "serie_a": {"code": "SA", "name": "Serie A", "country": "Italy"},
    "ligue_1": {"code": "FL1", "name": "Ligue 1", "country": "France"},
}

# Temporada corrente: na Understat o "season" é o ano do início (2026 => 2026/27).
DEFAULT_SEASON = 2026

# Índices das colunas retornadas por Understat.get_league_table(with_headers=False):
# [Team, M, W, D, L, G, GA, PTS, xG, NPxG, xGA, NPxGA, NPxGD, PPDA, OPPDA, DC, ODC, xPTS]
TABLE_COLUMNS = [
    "title", "matches", "wins", "draws", "losses", "goals_for", "goals_against",
    "points", "xg", "npxg", "xga", "npxga", "npxgd", "ppda", "oppda",
    "deep", "deep_allowed", "xpts",
]

SHOT_RESULT_GOAL = "Goal"
SHOT_RESULT_ON_TARGET = {"Goal", "SavedShot", "ShotOnPost"}

BODY_PART_MAP = {
    "RightFoot": "right_foot",
    "LeftFoot": "left_foot",
    "Head": "head",
    "OtherBodyPart": "other",
}

# Colunas de TeamStatistics vindas da tabela da liga. Não inclui os agregados
# derivados de chutes para que reexecuções não os sobrescrevam com zero.
TEAM_TABLE_COLS = [
    "matches_played", "wins", "draws", "losses", "goals_for", "goals_against",
    "xg_total", "xga_total", "xg_per_90", "xga_per_90", "goals_conceded_per_90",
    "points_per_game", "recent_form",
]
# Colunas de PlayerStatistics vindas da própria fonte (league players).
# shots_on_target não existe na fonte e é derivado dos chutes por partida.
PLAYER_SOURCE_COLS = [
    "matches_played", "minutes_played", "starts", "goals", "assists", "shots",
    "xg_total", "xa_total", "key_passes", "shots_per_90", "xg_per_90",
    "xa_per_90", "key_passes_per_90", "goals_per_90", "assists_per_90",
    "recent_form",
]
# Colunas derivadas dos chutes coletados (só aplicadas com cobertura completa).
TEAM_SHOT_COLS = ["shots", "shots_on_target", "shots_per_90", "shots_on_target_per_90"]
PLAYER_SHOT_COLS = ["shots_on_target", "shots_on_target_per_90"]


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _period_for(minute: int) -> str:
    if minute <= 45:
        return "1H"
    if minute <= 90:
        return "2H"
    return "ET"


# ---------------------------------------------------------------------------
# Upsert compatível com SQLite (testes) e PostgreSQL (produção)
# ---------------------------------------------------------------------------
def _execute_upsert(
    db: Session,
    table,
    rows: list[dict],
    constraint_cols: list[str],
    *,
    update_cols: Iterable[str] | None = None,
):
    """Insert-or-update idempotente. Retorna a quantidade de linhas enviadas."""
    if not rows:
        return 0
    bind = db.get_bind()
    dialect = bind.dialect.name if bind is not None else "sqlite"

    if update_cols is not None:
        update_names = list(update_cols)
    else:
        update_names = [
            c.name for c in table.columns
            if c.name not in constraint_cols and c.name != "id"
        ]

    if dialect == "postgresql":
        stmt = pg_insert(table).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=constraint_cols,
            set_={c: getattr(stmt.excluded, c) for c in update_names},
        )
    else:
        stmt = sqlite_insert(table).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=constraint_cols,
            set_={c: getattr(stmt.excluded, c) for c in update_names},
        )
    db.execute(stmt)
    return len(rows)


def _save_collection_state(db: Session, resource: str, status: str, summary: dict) -> None:
    row = db.scalar(
        select(CollectionState).where(
            CollectionState.provider == SOURCE.value,
            CollectionState.resource == resource,
        )
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if row is None:
        row = CollectionState(
            provider=SOURCE.value, resource=resource, status=status, summary=summary,
        )
        if status == "success":
            row.last_success_at = now
        db.add(row)
    else:
        row.status = status
        row.summary = summary
        if status == "success":
            row.last_success_at = now
    db.flush()


# ---------------------------------------------------------------------------
# Mapeamento de entidades (Understat ID -> banco interno)
# ---------------------------------------------------------------------------
class UnderstatMapper:
    """Cria/reutiliza entidades por (data_source, external_id) com cache em memória."""

    def __init__(self, db: Session, season_id: int):
        self.db = db
        self.season_id = season_id
        self._teams: dict[str, Team] = {}
        self._players: dict[str, Player] = {}
        self._players_by_name: dict[str, Player] = {}
        self._matches: dict[str, Match] = {}

    def preload(self, season_id: int | None = None, players: bool = True) -> None:
        """Carrega de uma vez times/jogadores/partidas já existentes.

        Sem isso, cada `get_or_create_*` faz um SELECT por entidade, o que é
        proibitivo com banco remoto (centenas de round-trips por liga).
        `players=False` pula a carga dos jogadores (use `preload_players_for_teams`).
        """
        sid = season_id if season_id is not None else self.season_id
        for t in self.db.scalars(select(Team).where(Team.data_source == SOURCE)).all():
            self._teams[t.external_id] = t
        if players:
            for p in self.db.scalars(select(Player).where(Player.data_source == SOURCE)).all():
                self._players[p.external_id] = p
                if p.display_name:
                    self._players_by_name.setdefault(p.display_name, p)
        for m in self.db.scalars(
            select(Match).where(Match.data_source == SOURCE, Match.season_id == sid)
        ).all():
            self._matches[m.external_id] = m

    def preload_players_for_teams(self, team_ids: Iterable[int]) -> None:
        """Carrega só os jogadores dos times informados (sync rápido)."""
        ids = {i for i in team_ids if i is not None}
        if not ids:
            return
        for p in self.db.scalars(
            select(Player).where(Player.data_source == SOURCE, Player.team_id.in_(ids))
        ).all():
            self._players.setdefault(p.external_id, p)
            if p.display_name:
                self._players_by_name.setdefault(p.display_name, p)

    def get_or_create_team(self, external_id: str, title: str, short_title: str | None = None) -> Team:
        key = str(external_id)
        if key in self._teams:
            return self._teams[key]
        team = self.db.scalar(
            select(Team).where(Team.data_source == SOURCE, Team.external_id == key)
        )
        if team is None:
            team = Team(
                external_id=key,
                name=title or f"Team {key}",
                short_name=short_title or title or f"Team {key}",
                data_source=SOURCE,
            )
            self.db.add(team)
            self.db.flush()
        else:
            if title and team.name != title:
                team.name = title
            if short_title and team.short_name != short_title:
                team.short_name = short_title
        self._teams[key] = team
        return team

    def get_or_create_player(self, external_id: str, player_name: str, team: Team) -> Player:
        key = str(external_id)
        if key in self._players:
            player = self._players[key]
            if player.team_id != team.id:
                player.team_id = team.id
            return player
        player = self.db.scalar(
            select(Player).where(Player.data_source == SOURCE, Player.external_id == key)
        )
        if player is None:
            full_name = player_name or f"Player {key}"
            parts = full_name.split()
            player = Player(
                external_id=key,
                first_name=" ".join(parts[:-1]) or None,
                last_name=parts[-1],
                display_name=full_name,
                team_id=team.id,
                data_source=SOURCE,
            )
            self.db.add(player)
            self.db.flush()
        else:
            if player.team_id != team.id:
                player.team_id = team.id
        self._players[key] = player
        if player_name:
            self._players_by_name.setdefault(player_name, player)
        return player

    def register_player_name(self, player: Player, name: str) -> None:
        if name:
            self._players_by_name.setdefault(name, player)

    def find_player_by_name(self, name: str) -> Player | None:
        return self._players_by_name.get(name)

    def get_or_create_match(
        self,
        external_id: str,
        home_team: Team,
        away_team: Team,
        kickoff: datetime | None,
        home_goals: int | None,
        away_goals: int | None,
        is_result: bool,
    ) -> Match:
        key = str(external_id)
        if key in self._matches:
            # Antes devolvia direto do cache: uma partida salva como "scheduled" nunca virava
            # "finished" (nem ganhava placar) nas execuções seguintes, e por isso ficava sem chutes.
            match = self._matches[key]
            self._refresh_match(match, kickoff, home_goals, away_goals, is_result)
            return match
        match = self.db.scalar(
            select(Match).where(Match.data_source == SOURCE, Match.external_id == key)
        )
        status = "finished" if is_result else "scheduled"
        if match is None:
            match = Match(
                external_id=key,
                season_id=self.season_id,
                home_team_id=home_team.id,
                away_team_id=away_team.id,
                kickoff_time=kickoff or datetime.now(timezone.utc).replace(tzinfo=None),
                home_score=home_goals,
                away_score=away_goals,
                status=status,
                data_source=SOURCE,
            )
            self.db.add(match)
            self.db.flush()
        else:
            self._refresh_match(match, kickoff, home_goals, away_goals, is_result)
        self._matches[key] = match
        return match

    def _refresh_match(
        self,
        match: Match,
        kickoff: datetime | None,
        home_goals: int | None,
        away_goals: int | None,
        is_result: bool,
    ) -> bool:
        """Atualiza status/placar/horário só quando mudou. Devolve True se alterou algo."""
        changed = False
        status = "finished" if is_result else "scheduled"
        if home_goals is not None and match.home_score != home_goals:
            match.home_score = home_goals
            changed = True
        if away_goals is not None and match.away_score != away_goals:
            match.away_score = away_goals
            changed = True
        if match.status != status:
            match.status = status
            changed = True
        if kickoff is not None and match.kickoff_time != kickoff:
            match.kickoff_time = kickoff
            changed = True
        if changed:
            self.db.flush()
        return changed


# ---------------------------------------------------------------------------
# Cliente Understat (com rate limit simples)
# ---------------------------------------------------------------------------
class UnderstatClient:
    def __init__(self, session: aiohttp.ClientSession, rate_sleep: float = 1.0):
        self.understat = Understat(session)
        self.rate_sleep = rate_sleep

    async def _sleep(self):
        if self.rate_sleep:
            await asyncio.sleep(self.rate_sleep)

    async def league_teams(self, league: str, season: int):
        await self._sleep()
        return await self.understat.get_teams(league, season)

    async def league_players(self, league: str, season: int):
        await self._sleep()
        return await self.understat.get_league_players(league, season)

    async def league_table(self, league: str, season: int):
        await self._sleep()
        # with_headers=False => lista de linhas já com apenas valores.
        return await self.understat.get_league_table(league, season, with_headers=False)

    async def league_results(self, league: str, season: int):
        await self._sleep()
        return await self.understat.get_league_results(league, season)

    async def league_fixtures(self, league: str, season: int):
        await self._sleep()
        return await self.understat.get_league_fixtures(league, season)

    async def match_shots(self, match_id: str):
        await self._sleep()
        return await self.understat.get_match_shots(match_id)

    async def player_shots(self, player_id: str):
        await self._sleep()
        return await self.understat.get_player_shots(player_id)


# ---------------------------------------------------------------------------
# Sincronização
# ---------------------------------------------------------------------------
def _get_or_create_competition(db: Session, league_key: str, season: int) -> tuple[Competition, Season]:
    info = UNDERSTAT_LEAGUES[league_key]
    comp = db.scalar(
        select(Competition).where(
            Competition.data_source == SOURCE, Competition.external_id == league_key
        )
    )
    if comp is None:
        comp = Competition(
            external_id=league_key,
            name=info["name"],
            code=info["code"],
            country=info["country"],
            type="league",
            data_source=SOURCE,
        )
        db.add(comp)
        db.flush()

    season_row = db.scalar(
        select(Season).where(
            Season.competition_id == comp.id, Season.name == str(season)
        )
    )
    if season_row is None:
        season_row = Season(
            competition_id=comp.id,
            name=str(season),
            start_date=datetime(season, 8, 1).date(),
            end_date=datetime(season + 1, 6, 30).date(),
            current=True,
            data_source=SOURCE,
        )
        db.add(season_row)
        db.flush()
    return comp, season_row


def _team_row_from_table(team: Team, season_id: int, table_row: list) -> dict:
    data = dict(zip(TABLE_COLUMNS, table_row))
    games = int(data.get("matches") or 0)
    goals_for = float(data.get("goals_for") or 0)
    goals_against = float(data.get("goals_against") or 0)
    xg = float(data.get("xg") or 0)
    xga = float(data.get("xga") or 0)
    points = int(data.get("points") or 0)

    def per90(total: float) -> float:
        return round(total / games, 2) if games else 0.0

    return {
        "team_id": team.id,
        "season_id": season_id,
        "scope": "overall",
        "matches_played": games,
        "wins": int(data.get("wins") or 0),
        "draws": int(data.get("draws") or 0),
        "losses": int(data.get("losses") or 0),
        "goals_for": goals_for,
        "goals_against": goals_against,
        "shots": 0.0,
        "shots_on_target": 0.0,
        "xg_total": xg,
        "xga_total": xga,
        "corners_total": 0.0,
        "shots_per_90": 0.0,
        "shots_on_target_per_90": 0.0,
        "xg_per_90": per90(xg),
        "xga_per_90": per90(xga),
        "goals_conceded_per_90": per90(goals_against),
        "shots_conceded_per_90": 0.0,
        "corners_per_90": 0.0,
        "points_per_game": round(points / games, 2) if games else 0.0,
        "recent_form": {
            "understat_team": team.name,
            "points": points,
            "npxg": float(data.get("npxg") or 0),
            "npxga": float(data.get("npxga") or 0),
            "npxgd": float(data.get("npxgd") or 0),
            "ppda": float(data.get("ppda") or 0),
            "oppda": float(data.get("oppda") or 0),
            "deep": float(data.get("deep") or 0),
            "deep_allowed": float(data.get("deep_allowed") or 0),
            "xpts": float(data.get("xpts") or 0),
            "goal_difference": goals_for - goals_against,
        },
    }


def _player_row(player: Player, season_id: int, raw: dict) -> dict:
    minutes = int(raw.get("time") or 0)
    games = int(raw.get("games") or 0)
    goals = int(raw.get("goals") or 0)
    assists = int(raw.get("assists") or 0)
    shots = int(raw.get("shots") or 0)
    key_passes = int(raw.get("key_passes") or 0)
    xg = float(raw.get("xG") or 0)
    xa = float(raw.get("xA") or 0)

    def per90(total: float) -> float:
        return round(total * 90 / minutes, 2) if minutes else 0.0

    return {
        "player_id": player.id,
        "season_id": season_id,
        "scope": "overall",
        "matches_played": games,
        "minutes_played": minutes,
        "starts": int(raw.get("games") or 0),
        "goals": goals,
        "assists": assists,
        "shots": shots,
        "shots_on_target": 0,
        "xg_total": xg,
        "xa_total": xa,
        "passes": 0,
        "passes_completed": 0,
        "key_passes": key_passes,
        "touches_in_box": 0,
        "dribbles": 0,
        "dribbles_success": 0,
        "fouls_suffered": 0,
        "fouls_committed": 0,
        "tackles": 0,
        "interceptions": 0,
        "clearances": 0,
        "duels": 0,
        "duels_won": 0,
        "crosses": 0,
        "crosses_completed": 0,
        "corners_taken": 0,
        "shots_per_90": per90(shots),
        "shots_on_target_per_90": 0.0,
        "xg_per_90": per90(xg),
        "xa_per_90": per90(xa),
        "key_passes_per_90": per90(key_passes),
        "touches_in_box_per_90": 0.0,
        "corners_per_90": 0.0,
        "goals_per_90": per90(goals),
        "assists_per_90": per90(assists),
        "tackle_pct": 0.0,
        "dribble_success_pct": 0.0,
        "pass_accuracy_pct": 0.0,
        "recent_form": {
            "position": raw.get("position"),
            "npg": int(raw.get("npg") or 0),
            "npxg": float(raw.get("npxG") or 0),
            "xg_chain": float(raw.get("xGChain") or 0),
            "xg_buildup": float(raw.get("xGBuildup") or 0),
            "yellow_cards": int(raw.get("yellow_cards") or 0),
            "red_cards": int(raw.get("red_cards") or 0),
            "team": raw.get("team_title"),
        },
        "pace": None,
        "dribbling": None,
        "defensive_workrate": None,
        "attacking_workrate": None,
    }


async def _ingest_league_structure(
    db: Session,
    client: UnderstatClient,
    mapper: UnderstatMapper,
    league_key: str,
    season: int,
    season_id: int,
    counts: dict,
) -> None:
    teams_raw = await client.league_teams(league_key, season)
    players_raw = await client.league_players(league_key, season)
    table_raw = await client.league_table(league_key, season)
    results_raw = await client.league_results(league_key, season)
    fixtures_raw = await client.league_fixtures(league_key, season)

    table_by_title = {}
    for row in table_raw or []:
        if row and row[0]:
            table_by_title[str(row[0])] = row

    team_rows: list[dict] = []
    for t in teams_raw or []:
        team = mapper.get_or_create_team(str(t["id"]), t.get("title"), t.get("short_title"))
        counts["teams"] += 1
        table_row = table_by_title.get(str(team.name))
        team_rows.append(
            _team_row_from_table(team, season_id, table_row) if table_row else {
                "team_id": team.id, "season_id": season_id, "scope": "overall",
                "matches_played": 0, "wins": 0, "draws": 0, "losses": 0,
                "goals_for": 0.0, "goals_against": 0.0, "shots": 0.0,
                "shots_on_target": 0.0, "xg_total": 0.0, "xga_total": 0.0,
                "corners_total": 0.0, "shots_per_90": 0.0, "shots_on_target_per_90": 0.0,
                "xg_per_90": 0.0, "xga_per_90": 0.0, "goals_conceded_per_90": 0.0,
                "shots_conceded_per_90": 0.0, "corners_per_90": 0.0,
                "points_per_game": 0.0, "recent_form": {"understat_team": team.name},
            }
        )
    player_rows: list[dict] = []
    for p in players_raw or []:
        pid = str(p.get("id"))
        team_title = p.get("team_title") or "Desconhecido"
        team_key = str(p.get("team_id") or "")
        if team_key and team_key != "0":
            team = mapper.get_or_create_team(team_key, team_title)
        else:
            # Sem team_id na fonte: reaproveita/cria por título sem inventar id externo.
            team = mapper.get_or_create_team(f"name:{team_title}", team_title)
        player = mapper.get_or_create_player(pid, p.get("player_name"), team)
        mapper.register_player_name(player, p.get("player_name"))
        counts["players"] += 1
        player_rows.append(_player_row(player, season_id, p))

    counts["table_rows"] = len(team_rows)
    _execute_upsert(
        db, TeamStatistics.__table__, team_rows, ["team_id", "season_id", "scope"],
        update_cols=TEAM_TABLE_COLS,
    )
    _execute_upsert(
        db, PlayerStatistics.__table__, player_rows, ["player_id", "season_id", "scope"],
        update_cols=PLAYER_SOURCE_COLS,
    )
    db.flush()

    # Partidas: resultados + jogos futuros vêm de datesData.
    _ingest_match_items(mapper, list(results_raw or []) + list(fixtures_raw or []), counts)


def _ingest_match_items(mapper: UnderstatMapper, items: list, counts: dict) -> None:
    """Cria/atualiza partidas (resultados + calendário) a partir do datesData da Understat."""
    for item in items:
        try:
            home = mapper.get_or_create_team(
                str(item["h"]["id"]), item["h"].get("title"), item["h"].get("short_title")
            )
            away = mapper.get_or_create_team(
                str(item["a"]["id"]), item["a"].get("title"), item["a"].get("short_title")
            )
        except (KeyError, TypeError):
            continue
        goals = item.get("goals") or {}
        is_result = bool(item.get("isResult"))
        mapper.get_or_create_match(
            str(item["id"]),
            home,
            away,
            _parse_datetime(item.get("datetime")),
            int(goals["h"]) if is_result and goals.get("h") is not None else None,
            int(goals["a"]) if is_result and goals.get("a") is not None else None,
            is_result,
        )
        counts["matches"] += 1


async def _ingest_match_shots(
    db: Session,
    client: UnderstatClient,
    mapper: UnderstatMapper,
    match: Match,
    counts: dict,
    shots_by_side: Any = None,
) -> None:
    understat_match_id = match.external_id
    if not understat_match_id:
        return

    if shots_by_side is None:  # sync rápido já baixa os chutes em paralelo e passa aqui
        try:
            shots_by_side = await client.match_shots(understat_match_id)
        except Exception as exc:  # falha isolada por partida não interrompe a liga
            counts["shot_errors"] += 1
            print(f"Aviso: falha ao buscar shots da partida {understat_match_id}: {exc}")
            return

    if not isinstance(shots_by_side, dict):
        return

    for side in ("h", "a"):
        team = match.home_team if side == "h" else match.away_team
        if team is None:
            continue
        for s in shots_by_side.get(side) or []:
            if s.get("h_a") and s.get("h_a") != side:
                # h_a é a fonte de verdade da posse do chute.
                side_team = match.home_team if s["h_a"] == "h" else match.away_team
                if side_team is None:
                    continue
                team = side_team

            shot_id = s.get("id")
            result = s.get("result")
            minute = int(s.get("minute") or 0)
            x = s.get("X")
            y = s.get("Y")
            if x is None or y is None:
                continue

            player = None
            player_id = s.get("player_id")
            if player_id is not None and str(player_id) != "0":
                player = mapper.get_or_create_player(str(player_id), s.get("player"), team)

            event = Event(
                external_id=f"us-shot-{understat_match_id}-{shot_id}",
                match_id=match.id,
                team_id=team.id,
                player_id=player.id if player else None,
                type=EventType.SHOT,
                minute=minute,
                second=None,
                period=_period_for(minute),
                outcome=result,
                details={
                    "understat_shot_id": str(shot_id),
                    "situation": s.get("situation"),
                    "shot_type": s.get("shotType"),
                    "last_action": s.get("lastAction"),
                    "assisted_by": s.get("player_assisted"),
                },
                data_source=SOURCE,
            )
            # Filhos ligados por relacionamento (Event.position/shot/goal): o
            # flush único no fim da partida insere tudo em lote, evitando um
            # round-trip por chute (crítico quando o banco é remoto).
            event.position = EventPosition(x=float(x) * 100.0, y=float(y) * 100.0)
            event.shot = Shot(
                on_target=result in SHOT_RESULT_ON_TARGET,
                is_goal=result == SHOT_RESULT_GOAL,
                body_part=BODY_PART_MAP.get(s.get("shotType")),
                situation=s.get("situation"),
                shot_type=s.get("shotType"),
                xg=float(s.get("xG") or 0),
                psxg=None,
            )
            db.add(event)
            counts["events"] += 1
            counts["shots"] += 1

            if result == SHOT_RESULT_GOAL and player is not None:
                goal_event = Event(
                    external_id=f"us-goal-{understat_match_id}-{shot_id}",
                    match_id=match.id,
                    team_id=team.id,
                    player_id=player.id,
                    type=EventType.GOAL,
                    minute=minute,
                    period=_period_for(minute),
                    outcome=SHOT_RESULT_GOAL,
                    details={"understat_shot_id": str(shot_id)},
                    data_source=SOURCE,
                )
                assist = mapper.find_player_by_name(s.get("player_assisted") or "")
                goal_event.goal = Goal(
                    scorer_player_id=player.id,
                    assist_player_id=assist.id if assist else None,
                    is_penalty=(s.get("situation") == "Penalty"),
                    is_own_goal=False,
                    body_part=BODY_PART_MAP.get(s.get("shotType")),
                )
                db.add(goal_event)
                counts["events"] += 1

    # Um flush por partida: o unit-of-work insere eventos e filhos em lote.
    db.flush()

    # Estatística de time por partida (derivada dos chutes reais).
    def _tms(team: Team, is_home: bool, own: list[dict], opp: list[dict]) -> dict:
        return {
            "team_id": team.id,
            "match_id": match.id,
            "is_home": is_home,
            "goals": sum(1 for s in own if s.get("result") == SHOT_RESULT_GOAL),
            "goals_conceded": sum(1 for s in opp if s.get("result") == SHOT_RESULT_GOAL),
            "shots": len(own),
            "shots_on_target": sum(1 for s in own if s.get("result") in SHOT_RESULT_ON_TARGET),
            "xg": round(sum(float(s.get("xG") or 0) for s in own), 2),
            "xga": round(sum(float(s.get("xG") or 0) for s in opp), 2),
            "possession_pct": None,
            "passes": 0,
            "passes_completed": 0,
            "corners": sum(1 for s in own if s.get("situation") == "FromCorner"),
            "fouls": 0,
            "tackles": 0,
            "interceptions": 0,
            "saves": 0,
        }

    home_shots = shots_by_side.get("h") or []
    away_shots = shots_by_side.get("a") or []
    if (home_shots or away_shots) and match.home_team and match.away_team:
        _execute_upsert(
            db,
            TeamMatchStatistics.__table__,
            [_tms(match.home_team, True, home_shots, away_shots),
             _tms(match.away_team, False, away_shots, home_shots)],
            ["team_id", "match_id"],
        )
        counts["tms_rows"] += 2


async def sync_understat_league(
    db: Session,
    client: UnderstatClient,
    league_key: str,
    season: int = DEFAULT_SEASON,
    *,
    shots_only: bool = False,
    max_matches: int | None = None,
) -> dict[str, Any]:
    """Sincroniza uma liga/temporada. Idempotente: pode ser reexecutado."""
    _, season_row = _get_or_create_competition(db, league_key, season)
    mapper = UnderstatMapper(db, season_row.id)
    mapper.preload(season_row.id)
    counts = {
        "league": league_key, "season": season,
        "teams": 0, "players": 0, "matches": 0, "shots": 0, "events": 0,
        "table_rows": 0, "tms_rows": 0, "shot_errors": 0,
    }

    if not shots_only:
        await _ingest_league_structure(
            db, client, mapper, league_key, season, season_row.id, counts
        )
        db.commit()

    matches = db.scalars(
        select(Match)
        .options(selectinload(Match.home_team), selectinload(Match.away_team))
        .where(Match.season_id == season_row.id, Match.data_source == SOURCE)
    ).all()

    finished = [m for m in matches if m.status == "finished"]
    # Idempotente: só coleta chutes de partidas que ainda não os possuem
    # (vale tanto para o modo completo quanto para --shots-only). Uma única
    # consulta evita um SELECT por partida (custo alto em banco remoto).
    pending = []
    if finished:
        shot_match_ids = set(db.scalars(
            select(Event.match_id)
            .join(Match, Match.id == Event.match_id)
            .where(
                Event.data_source == SOURCE,
                Event.type == EventType.SHOT,
                Match.season_id == season_row.id,
            )
        ).all())
        pending = [m for m in finished if m.id not in shot_match_ids]
    if max_matches is not None:
        pending = pending[:max_matches]

    # Commit em lotes: com banco remoto (Neon) uma única transação para centenas
    # de partidas é lenta e arriscada; o upsert idempotente permite retomar de
    # onde parou em caso de falha.
    BATCH = 5
    for idx, match in enumerate(pending, start=1):
        await _ingest_match_shots(db, client, mapper, match, counts)
        if idx % BATCH == 0:
            db.commit()
            print(f"  {league_key}: chutes {idx}/{len(pending)} partidas", flush=True)
    db.commit()

    # Agregados de chutes da temporada (recalculados do banco => idempotente).
    # Só são aplicados quando TODAS as partidas finalizadas já têm chutes
    # coletados; caso contrário a soma seria parcial e não representaria a
    # temporada, violando a regra de não inventar dados.
    finished_ids = set(db.scalars(
        select(Match.id).where(
            Match.season_id == season_row.id,
            Match.data_source == SOURCE,
            Match.status == "finished",
        )
    ).all())
    shot_match_ids = set(db.scalars(
        select(Event.match_id)
        .join(Match, Match.id == Event.match_id)
        .where(
            Event.data_source == SOURCE,
            Event.type == EventType.SHOT,
            Match.season_id == season_row.id,
        )
    ).all())
    covered = bool(finished_ids) and finished_ids.issubset(shot_match_ids)
    counts["shot_coverage"] = f"{len(finished_ids & shot_match_ids)}/{len(finished_ids)}"

    if covered:
        shot_rows = db.execute(
            select(Event.team_id, Event.player_id, Shot.on_target)
            .join(Shot, Shot.event_id == Event.id)
            .join(Match, Match.id == Event.match_id)
            .where(
                Event.data_source == SOURCE,
                Event.type == EventType.SHOT,
                Match.season_id == season_row.id,
            )
        ).all()

        team_agg: dict[int, dict] = {}
        player_agg: dict[int, dict] = {}
        for team_id, player_id, on_target in shot_rows:
            bucket = team_agg.setdefault(team_id, {"shots": 0, "on_target": 0})
            bucket["shots"] += 1
            if on_target:
                bucket["on_target"] += 1
            if player_id is not None:
                pbucket = player_agg.setdefault(player_id, {"on_target": 0})
                if on_target:
                    pbucket["on_target"] += 1

        team_updates = []
        for st in db.scalars(
            select(TeamStatistics).where(TeamStatistics.season_id == season_row.id)
        ).all():
            agg = team_agg.get(st.team_id)
            if not agg:
                continue
            games = st.matches_played or 0
            team_updates.append({
                "team_id": st.team_id, "season_id": st.season_id, "scope": st.scope,
                "shots": float(agg["shots"]),
                "shots_on_target": float(agg["on_target"]),
                "shots_per_90": round(agg["shots"] / games, 2) if games else 0.0,
                "shots_on_target_per_90": round(agg["on_target"] / games, 2) if games else 0.0,
            })
        if team_updates:
            _execute_upsert(
                db, TeamStatistics.__table__, team_updates,
                ["team_id", "season_id", "scope"], update_cols=TEAM_SHOT_COLS,
            )

        player_updates = []
        for pst in db.scalars(
            select(PlayerStatistics).where(PlayerStatistics.season_id == season_row.id)
        ).all():
            agg = player_agg.get(pst.player_id)
            if not agg:
                continue
            minutes = pst.minutes_played or 0
            player_updates.append({
                "player_id": pst.player_id, "season_id": pst.season_id, "scope": pst.scope,
                "shots_on_target": agg["on_target"],
                "shots_on_target_per_90": round(agg["on_target"] * 90 / minutes, 2) if minutes else 0.0,
            })
        if player_updates:
            _execute_upsert(
                db, PlayerStatistics.__table__, player_updates,
                ["player_id", "season_id", "scope"], update_cols=PLAYER_SHOT_COLS,
            )
        db.commit()

    counts["matches_with_shots"] = len(pending)
    from app.services.match_reconciliation import reconcile_matches
    counts["match_reconciliation"] = reconcile_matches(db)
    _save_collection_state(db, league_key, "success", counts)
    db.commit()
    return counts


# ---------------------------------------------------------------------------
# Sincronização RÁPIDA (botão da tela Understat e rotina agendada)
# ---------------------------------------------------------------------------
def _count_shot_events(db: Session, season_id: int) -> int:
    """Total de chutes da Understat gravados para a temporada (o card da tela usa isso)."""
    return int(db.scalar(
        select(func.count())
        .select_from(Event)
        .join(Match, Match.id == Event.match_id)
        .where(Event.data_source == SOURCE, Event.type == EventType.SHOT, Match.season_id == season_id)
    ) or 0)


def _pending_finished_matches(db: Session, season_id: int) -> list[Match]:
    """Partidas finalizadas da Understat que ainda não têm chutes (mais recentes primeiro)."""
    finished = db.scalars(
        select(Match)
        .options(selectinload(Match.home_team), selectinload(Match.away_team))
        .where(Match.season_id == season_id, Match.data_source == SOURCE, Match.status == "finished")
        .order_by(Match.kickoff_time.desc())
    ).all()
    if not finished:
        return []
    with_shots = set(db.scalars(
        select(Event.match_id)
        .join(Match, Match.id == Event.match_id)
        .where(Event.data_source == SOURCE, Event.type == EventType.SHOT, Match.season_id == season_id)
        .distinct()
    ).all())
    return [m for m in finished if m.id not in with_shots]


async def _fetch_calendar(client: UnderstatClient, league: str, season: int) -> list:
    results, fixtures = await asyncio.gather(
        client.league_results(league, season), client.league_fixtures(league, season)
    )
    return list(results or []) + list(fixtures or [])


# Partidas já tentadas sem sucesso (fonte sem chutes ou erro): vão para o FIM da fila por um tempo,
# para que as mais novas ainda não publicadas não bloqueiem as mais antigas.
_RECENT_ATTEMPTS: dict[int, float] = {}
_ATTEMPT_TTL = 20 * 60  # segundos


async def _fetch_shots_safe(client: UnderstatClient, match: Match, counts: dict, timeout: float):
    """Baixa os chutes de uma partida. Tenta 2x (falha transitória/limite de taxa) e registra o erro."""
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            data = await asyncio.wait_for(client.match_shots(match.external_id), timeout=timeout)
            return data if isinstance(data, dict) else None
        except Exception as exc:  # noqa: BLE001 - falha isolada por partida
            last_exc = exc
            if attempt == 0:
                await asyncio.sleep(0.8)
    counts["shot_errors"] += 1
    samples = counts.setdefault("error_samples", [])
    if len(samples) < 3:
        samples.append(f"{match.external_id}: {type(last_exc).__name__}: {str(last_exc)[:120]}")
    print(f"Aviso: falha ao buscar shots da partida {match.external_id}: {last_exc}")
    return None


async def sync_understat_fast(
    client: UnderstatClient,
    leagues: list[str],
    season: int = DEFAULT_SEASON,
    *,
    max_seconds: float = 8.0,
    max_matches: int = 40,
    concurrency: int = 4,
    refresh_calendar: bool = True,
    session_factory=None,
) -> dict[str, Any]:
    """Sincronização incremental e rápida, só da Understat.

    Diferenças para `sync_understat_league`:
      * só atualiza o calendário/resultados (sem tabela, sem milhares de jogadores);
      * baixa os chutes de várias partidas em paralelo, das mais recentes para as antigas;
      * o orçamento `max_seconds` vale para a fase de chutes (o calendário não o consome);
      * partidas que a fonte ainda não publicou vão para o fim da fila (não travam as antigas);
      * pode ser chamada de novo enquanto `candidates > 0` (nas chamadas seguintes use
        `refresh_calendar=False`: pula a rede do calendário e várias consultas ao banco);
      * não recalcula agregados de temporada (isso fica para a rotina completa).
    """
    session_factory = session_factory or SessionLocal
    started = time.monotonic()
    results: dict[str, dict[str, Any]] = {
        lg: {"league": lg, "season": season, "matches": 0, "shots": 0, "events": 0,
             "tms_rows": 0, "shot_errors": 0, "empty": 0}
        for lg in leagues
    }
    dbs: dict[str, Session] = {}
    mappers: dict[str, UnderstatMapper] = {}
    season_ids: dict[str, int] = {}
    ingested: dict[str, int] = {lg: 0 for lg in leagues}
    progress = 0
    attempted = 0
    candidates = 0
    remaining = 0
    try:
        # Fase 1 — calendário e resultados de todas as ligas em paralelo (só rede).
        if refresh_calendar:
            calendars = await asyncio.gather(
                *[_fetch_calendar(client, lg, season) for lg in leagues], return_exceptions=True
            )
        else:
            calendars = [[] for _ in leagues]
        pending_all: list[tuple[Any, str, Match]] = []
        for lg, cal in zip(leagues, calendars):
            counts = results[lg]
            if isinstance(cal, BaseException):
                counts["error"] = f"{type(cal).__name__}: {cal}"
                continue
            db = session_factory()
            dbs[lg] = db
            _, season_row = _get_or_create_competition(db, lg, season)
            season_ids[lg] = season_row.id
            mapper = UnderstatMapper(db, season_row.id)
            mapper.preload(season_row.id, players=False)
            mappers[lg] = mapper
            if refresh_calendar:
                _ingest_match_items(mapper, cal, counts)
                db.commit()
            pending = _pending_finished_matches(db, season_row.id)
            counts["pending_before"] = len(pending)
            pending_all.extend((m.kickoff_time, lg, m) for m in pending)

        # Fila: primeiro as não tentadas há pouco (mais novas antes), depois as já tentadas sem sucesso.
        now = time.time()
        fresh = [r for r in pending_all if now - _RECENT_ATTEMPTS.get(r[2].id, 0) > _ATTEMPT_TTL]
        stale = [r for r in pending_all if now - _RECENT_ATTEMPTS.get(r[2].id, 0) <= _ATTEMPT_TTL]
        fresh.sort(key=lambda r: r[0], reverse=True)
        stale.sort(key=lambda r: r[0], reverse=True)
        candidates = len(fresh)
        queue = (fresh + stale)[:max_matches]
        for lg, mapper in mappers.items():
            mapper.preload_players_for_teams(
                tid for _, qlg, m in queue if qlg == lg for tid in (m.home_team_id, m.away_team_id)
            )

        # Fase 2 — chutes em lotes paralelos; o orçamento conta a partir daqui.
        deadline = time.monotonic() + max_seconds
        idx = 0
        while idx < len(queue) and (idx == 0 or time.monotonic() < deadline - 1.0):
            chunk = queue[idx: idx + concurrency]
            idx += len(chunk)
            budget = max(2.0, deadline - time.monotonic())
            fetched = await asyncio.gather(
                *[_fetch_shots_safe(client, m, results[lg], budget) for _, lg, m in chunk]
            )
            for (_, lg, m), data in zip(chunk, fetched):
                if time.monotonic() >= deadline:
                    break  # tempo esgotado: as demais ficam pendentes para a próxima rodada
                attempted += 1
                if data is None:
                    _RECENT_ATTEMPTS[m.id] = time.time()  # erro (já contado)
                    continue
                if not (data.get("h") or data.get("a")):
                    results[lg]["empty"] += 1  # a fonte ainda não publicou os chutes desta partida
                    _RECENT_ATTEMPTS[m.id] = time.time()
                    continue
                try:
                    await _ingest_match_shots(
                        dbs[lg], client, mappers[lg], m, results[lg], shots_by_side=data
                    )
                    progress += 1
                    ingested[lg] += 1
                    _RECENT_ATTEMPTS.pop(m.id, None)
                except Exception as exc:  # noqa: BLE001
                    dbs[lg].rollback()
                    results[lg]["shot_errors"] += 1
                    _RECENT_ATTEMPTS[m.id] = time.time()
                    samples = results[lg].setdefault("error_samples", [])
                    if len(samples) < 3:
                        samples.append(f"{m.external_id}: gravação: {type(exc).__name__}: {str(exc)[:120]}")
                    print(f"Aviso: falha ao gravar shots da partida {m.external_id}: {exc}")
            for db in dbs.values():
                db.commit()

        for lg, db in dbs.items():
            left = max(0, results[lg].get("pending_before", 0) - ingested[lg])
            results[lg]["pending_after"] = left
            remaining += left
            # Só grava o estado se algo mudou (evita idas ao banco remoto à toa nas rodadas seguintes).
            if refresh_calendar or ingested[lg] or results[lg]["shot_errors"]:
                # "parcial" só quando houve ERRO; partidas que a fonte ainda não publicou não são erro.
                status = "partial" if results[lg]["shot_errors"] > 0 else "success"
                # `shots` = total gravado na temporada (e não só o desta rodada), senão o card zera.
                summary = {**results[lg], "shots": _count_shot_events(db, season_ids[lg]), "fast": True}
                _save_collection_state(db, lg, status, summary)
                db.commit()
        candidates = max(0, candidates - attempted)
    finally:
        for db in dbs.values():
            db.close()

    return {
        "leagues": results,
        "progress": progress,      # partidas que ganharam chutes nesta chamada
        "attempted": attempted,    # partidas consultadas na fonte nesta chamada
        "candidates": candidates,  # ainda não tentadas há pouco: vale chamar de novo
        "remaining": remaining,    # finalizadas ainda sem chutes (a fonte pode não ter publicado)
        "elapsed": round(time.monotonic() - started, 1),
    }


# ---------------------------------------------------------------------------
# Ponto de entrada
# ---------------------------------------------------------------------------
async def _async_main(
    leagues: list[str],
    season: int,
    shots_only: bool,
    max_matches: int | None,
) -> dict[str, Any]:
    connector = aiohttp.TCPConnector(limit=5)
    results: dict[str, Any] = {}
    async with aiohttp.ClientSession(connector=connector) as session:
        client = UnderstatClient(session)
        for league in leagues:
            print(f"\n=== Sincronizando {league} ({season}) ===")
            with SessionLocal() as db:
                try:
                    counts = await sync_understat_league(
                        db, client, league, season,
                        shots_only=shots_only, max_matches=max_matches,
                    )
                    results[league] = counts
                    print(json.dumps(counts, indent=2, ensure_ascii=False))
                except Exception as exc:
                    db.rollback()
                    results[league] = {"error": str(exc)}
                    print(f"Erro ao sincronizar {league}: {exc}")
                    try:
                        _save_collection_state(db, league, "failed", {"error": str(exc)})
                        db.commit()
                    except Exception:
                        db.rollback()
    return results


async def _async_fast(leagues: list[str], season: int, max_seconds: float, max_matches: int) -> int:
    connector = aiohttp.TCPConnector(limit=8)
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        client = UnderstatClient(session, rate_sleep=0.15)
        for round_no in range(1, 16):  # no máximo 15 rodadas
            out = await sync_understat_fast(
                client, leagues, season, max_seconds=max_seconds, max_matches=max_matches
            )
            print(f"Rodada {round_no}: +{out['progress']} partidas com chutes, "
                  f"{out['attempted']} consultadas, faltam {out['remaining']} ({out['elapsed']}s)")
            errors = [k for k, v in out["leagues"].items() if v.get("error")]
            if errors:
                print(f"Ligas com erro: {errors}")
            if out["remaining"] == 0 or out["candidates"] == 0:
                return 1 if errors else 0
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--leagues", nargs="+", default=["epl"],
                        help="Ligas da Understat (padrão: epl). Use 'all' para as 5 europeias.")
    parser.add_argument("--season", type=int, default=DEFAULT_SEASON,
                        help=f"Temporada = ano de início (padrão: {DEFAULT_SEASON}).")
    parser.add_argument("--shots-only", action="store_true",
                        help="Apenas atualiza chutes das partidas já cadastradas.")
    parser.add_argument("--max-matches", type=int, default=None,
                        help="Limita o número de partidas processadas para shots (útil para smoke test).")
    parser.add_argument("--fast", action="store_true",
                        help="Modo rápido (calendário + chutes em paralelo, só o que falta). Repete até zerar.")
    parser.add_argument("--max-seconds", type=float, default=240.0,
                        help="Orçamento de tempo por rodada no modo --fast (padrão: 240).")
    args = parser.parse_args(argv)

    leagues = [l.strip().lower() for l in args.leagues]
    if leagues == ["all"]:
        leagues = list(UNDERSTAT_LEAGUES.keys())
    invalid = [l for l in leagues if l not in UNDERSTAT_LEAGUES]
    if invalid:
        print(f"Ligas inválidas: {invalid}. Válidas: {list(UNDERSTAT_LEAGUES.keys())}")
        return 1

    print(f"Iniciando sincronização Understat: ligas={leagues}, temporada={args.season}")
    if args.fast:
        return asyncio.run(_async_fast(leagues, args.season, args.max_seconds, args.max_matches or 400))
    results = asyncio.run(_async_main(leagues, args.season, args.shots_only, args.max_matches))
    failed = [k for k, v in results.items() if isinstance(v, dict) and v.get("error")]
    print("\nSincronização concluída.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
