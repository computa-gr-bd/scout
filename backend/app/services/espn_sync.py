"""Complement existing league fixtures with ESPN lineups and match statistics.

Run from ``backend``:
    python -m app.services.espn_sync --leagues PL PD BL1 SA FL1 --season 2026-27

Only already-finished matches, teams, and players in the database are linked.
Downloaded JSON is cached outside the repository so imports can resume safely.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import logging
import math
from pathlib import Path
import re
import time
from typing import Any, Mapping

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.db import SessionLocal
from app.db.models import (
    CollectionState, Competition, Lineup, Match, Player, PlayerMatchStatistics,
    Season, Team, TeamMatchStatistics,
)
from app.services.soccerdata_sync import (
    MATCH_DATE_TOLERANCE, PlayerResolver, _data_source_priority, _match_schedule,
    _score, _source_bucket, _source_date, _target_match,
)
from app.services.studio import _same_team_name, norm_team

logger = logging.getLogger(__name__)

ESPN_LEAGUES = {
    "PL": "eng.1",
    "PD": "esp.1",
    "BL1": "ger.1",
    "SA": "ita.1",
    "FL1": "fra.1",
}
BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer"
REQUEST_TIMEOUT = 30
DEFAULT_DELAY = 0.25
ESPN_TEAM_ALIAS_GROUPS = (
    {"rb leipzig", "rasenballsport leipzig"},
    {"borussia monchengladbach", "borussia m gladbach"},
    {"hamburg sv", "hamburger sv"},
    {"rennes", "stade rennais", "stade rennais 1901"},
    {"bayer leverkusen", "bayer 04 leverkusen"},
    {"psv", "psv eindhoven"},
    {"slavia prague", "slavia praha"},
    {"sporting cp", "sporting clube portugal"},
    {"aek athens", "pae aek"},
    {"bodo glimt", "bod glimt"},
)
PLAYER_STAT_FIELDS = {
    "totalGoals": "goals",
    "goalAssists": "assists",
    "totalShots": "shots",
    "shotsOnTarget": "shots_on_target",
    "foulsCommitted": "fouls_committed",
    "foulsSuffered": "fouls_suffered",
    "saves": "saves",
    "goalsConceded": "goals_conceded",
    "shotsFaced": "shots_faced",
}
TEAM_STAT_FIELDS = {
    "totalShots": "shots",
    "shotsOnTarget": "shots_on_target",
    "possessionPct": "possession_pct",
    "totalPasses": "passes",
    "accuratePasses": "passes_completed",
    "wonCorners": "corners",
    "foulsCommitted": "fouls",
    "totalTackles": "tackles",
    "interceptions": "interceptions",
    "totalClearance": "clearances",
    "blockedShots": "shots_blocked",
    "saves": "saves",
}
TEAM_RAW_STATS = {
    "effectiveTackles", "totalTackles", "tacklePct", "interceptions",
    "effectiveClearance", "totalClearance", "blockedShots", "saves",
    "possessionPct", "totalPasses", "accuratePasses", "passPct",
    "accurateCrosses", "totalCrosses", "crossPct", "totalLongBalls",
    "accurateLongBalls", "longballPct", "offsides", "yellowCards",
    "redCards", "foulsCommitted", "wonCorners", "totalShots",
    "shotsOnTarget", "shotPct",
}
PLAYER_RAW_STATS = set(PLAYER_STAT_FIELDS) | {
    "appearances", "yellowCards", "redCards", "ownGoals", "subIns",
}


def _json_value(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        value = json.load(file)
    if not isinstance(value, dict):
        raise ValueError(f"Resposta ESPN inválida em cache: {path}")
    return value


class ESPNClient:
    def __init__(
        self,
        cache_dir: Path | None = None,
        *,
        delay: float = DEFAULT_DELAY,
        session: requests.Session | None = None,
    ):
        self.cache_dir = cache_dir or Path.home() / ".scoutvision" / "espn-cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.delay = max(0.0, delay)
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": "ScoutVision-data-sync/1.0"})
        self._last_request_at = 0.0

    def _get_json(self, url: str, cache_file: Path) -> dict[str, Any]:
        if cache_file.exists():
            return _json_value(cache_file)

        wait = self.delay - (time.monotonic() - self._last_request_at)
        if wait > 0:
            time.sleep(wait)
        response = self.session.get(url, timeout=REQUEST_TIMEOUT)
        self._last_request_at = time.monotonic()
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Resposta ESPN inválida: {url}")
        temporary = cache_file.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(cache_file)
        return payload

    def scoreboard(self, league: str, day: date) -> dict[str, Any]:
        key = ESPN_LEAGUES[league]
        cache_file = self.cache_dir / f"scoreboard-{key}-{day:%Y%m%d}.json"
        return self._get_json(
            f"{BASE_URL}/{key}/scoreboard?dates={day:%Y%m%d}",
            cache_file,
        )

    def summary(self, event_id: str) -> dict[str, Any]:
        cache_file = self.cache_dir / f"summary-{event_id}.json"
        return self._get_json(
            f"{BASE_URL}/all/summary?event={event_id}",
            cache_file,
        )


def _event_competition(event: Mapping[str, Any]) -> Mapping[str, Any] | None:
    competitions = event.get("competitions")
    if not isinstance(competitions, list) or not competitions:
        return None
    competition = competitions[0]
    return competition if isinstance(competition, dict) else None


def _same_espn_team_name(first: str, second: str) -> bool:
    first_norm, second_norm = norm_team(first), norm_team(second)
    if _same_team_name(first_norm, second_norm):
        return True
    return any(first_norm in aliases and second_norm in aliases for aliases in ESPN_TEAM_ALIAS_GROUPS)


def _same_fixture(
    first: Match,
    first_home: str,
    first_away: str,
    second: Match,
    second_home: str,
    second_away: str,
) -> bool:
    if abs(first.kickoff_time.date() - second.kickoff_time.date()) > MATCH_DATE_TOLERANCE:
        return False
    direct = (
        _same_espn_team_name(first_home, second_home)
        and _same_espn_team_name(first_away, second_away)
    )
    reversed_teams = (
        _same_espn_team_name(first_home, second_away)
        and _same_espn_team_name(first_away, second_home)
    )
    if not direct and not reversed_teams:
        return False
    scores = (
        (
            (first.home_score, second.home_score),
            (first.away_score, second.away_score),
        )
        if direct else (
            (first.home_score, second.away_score),
            (first.away_score, second.home_score),
        )
    )
    return all(
        first_score is None or second_score is None or first_score == second_score
        for first_score, second_score in scores
    )


def _align_schedule_team_names(
    db: Session,
    league_code: str,
    season: str,
    schedule_rows: list[dict[str, Any]],
) -> int:
    start_year = int(season[:4])
    start, end = date(start_year, 7, 1), date(start_year + 1, 7, 1)
    home_alias, away_alias = aliased(Team), aliased(Team)
    source_matches = db.execute(
        select(Match, home_alias.name, away_alias.name)
        .join(home_alias, home_alias.id == Match.home_team_id)
        .join(away_alias, away_alias.id == Match.away_team_id)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(
            Competition.code == league_code,
            Match.kickoff_time >= datetime.combine(start, datetime.min.time()),
            Match.kickoff_time < datetime.combine(end, datetime.min.time()),
        )
    ).all()
    targets: dict[int, tuple[Match, str, str]] = {}
    for source_match, source_home, source_away in source_matches:
        target = _target_match(source_match, db)
        if target.status != "finished":
            continue
        if target.id == source_match.id:
            targets[target.id] = (target, source_home, source_away)
        else:
            home, away = db.get(Team, target.home_team_id), db.get(Team, target.away_team_id)
            if home is not None and away is not None:
                targets[target.id] = (target, home.name, away.name)

    aligned = 0
    for source in schedule_rows:
        source_date = _source_date(source)
        score = _score(source.get("score"))
        home_name, away_name = source.get("home_team"), source.get("away_team")
        if source_date is None or score is None or not home_name or not away_name:
            continue
        candidates = [
            (match, canonical_home, canonical_away)
            for match, canonical_home, canonical_away in targets.values()
            if (
                abs(match.kickoff_time.date() - source_date) <= MATCH_DATE_TOLERANCE
                and (match.home_score, match.away_score) == score
                and _same_espn_team_name(str(home_name), canonical_home)
                and _same_espn_team_name(str(away_name), canonical_away)
            )
        ]
        if candidates:
            _, canonical_home, canonical_away = min(
                candidates,
                key=lambda candidate: _data_source_priority(candidate[0].data_source),
            )
            source["home_team"] = canonical_home
            source["away_team"] = canonical_away
            aligned += 1
    return aligned


def _event_schedule_row(event: Mapping[str, Any], season: str) -> dict[str, Any] | None:
    competition = _event_competition(event)
    if competition is None:
        return None
    competitors = competition.get("competitors")
    if not isinstance(competitors, list):
        return None
    by_side = {
        row.get("homeAway"): row
        for row in competitors
        if isinstance(row, dict) and row.get("homeAway") in ("home", "away")
    }
    home, away = by_side.get("home"), by_side.get("away")
    if not home or not away:
        return None
    home_team = home.get("team") or {}
    away_team = away.get("team") or {}
    home_name = home_team.get("displayName") or home_team.get("name")
    away_name = away_team.get("displayName") or away_team.get("name")
    event_id = event.get("id")
    if not home_name or not away_name or event_id is None:
        return None
    home_score, away_score = home.get("score"), away.get("score")
    score = None
    if home_score not in (None, "") and away_score not in (None, ""):
        score = f"{home_score}-{away_score}"
    return {
        "game_id": str(event_id),
        "date": event.get("date"),
        "season": season,
        "home_team": str(home_name),
        "away_team": str(away_name),
        "score": score,
        "completed": bool(
            ((event.get("status") or {}).get("type") or {}).get("completed")
        ),
    }


def _event_is_complete(event: Mapping[str, Any]) -> bool:
    status = event.get("status")
    return bool(
        isinstance(status, dict)
        and isinstance(status.get("type"), dict)
        and status["type"].get("completed")
    )


def _number(value: Any) -> int | float | None:
    if value is None or value == "":
        return None
    try:
        result = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    return result


def _stat_values(rows: Any) -> dict[str, int | float]:
    if not isinstance(rows, list):
        return {}
    result: dict[str, int | float] = {}
    for entry in rows:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        value = _number(entry.get("value", entry.get("displayValue")))
        if value is not None:
            result[str(entry["name"])] = value
    return result


def _roster_rows(
    payload: Mapping[str, Any],
    match: Match,
    team_names_by_id: Mapping[int, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rosters = payload.get("rosters")
    if not isinstance(rosters, list):
        raise ValueError("Resumo ESPN não contém escalações.")
    team_ids_by_side = {
        "home": match.home_team_id,
        "away": match.away_team_id,
    }
    lineups: list[dict[str, Any]] = []
    players: list[dict[str, Any]] = []
    for roster in rosters:
        if not isinstance(roster, dict):
            continue
        side = roster.get("homeAway")
        if side not in team_ids_by_side:
            continue
        source_team = roster.get("team")
        source_team_name = (
            source_team.get("displayName") or source_team.get("name")
            if isinstance(source_team, dict) else None
        )
        team_id = (
            _team_id_for_match(source_team_name, match, team_names_by_id)
            if source_team_name else None
        ) or team_ids_by_side[side]
        team_name = team_names_by_id.get(team_id) if team_id is not None else None
        if team_name is None:
            continue
        entries = roster.get("roster")
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            athlete = entry.get("athlete")
            name = entry.get("name")
            if not name and isinstance(athlete, dict):
                name = (
                    athlete.get("displayName")
                    or athlete.get("fullName")
                    or athlete.get("name")
                )
            if not name:
                continue
            position = entry.get("position")
            position_name = (
                position.get("abbreviation") or position.get("displayName")
                if isinstance(position, dict) else None
            )
            jersey = _number(entry.get("jersey"))
            lineups.append({
                "team": team_name,
                "player": str(name),
                "jersey_number": int(jersey) if jersey is not None else None,
                "position": position_name,
                "is_starter": bool(entry.get("starter", False)),
            })
            players.append({
                "team": team_name,
                "player": str(name),
                "stats": _stat_values(entry.get("stats")),
            })
    if not lineups:
        raise ValueError("Resumo ESPN não trouxe jogadores para as escalações.")
    return lineups, players


def _boxscore_rows(
    payload: Mapping[str, Any],
    match: Match,
    team_names_by_id: Mapping[int, str],
) -> list[dict[str, Any]]:
    boxscore = payload.get("boxscore")
    teams = boxscore.get("teams") if isinstance(boxscore, dict) else None
    if not isinstance(teams, list):
        raise ValueError("Resumo ESPN não contém estatísticas coletivas.")
    by_side: dict[str, dict[str, Any]] = {}
    for team in teams:
        if not isinstance(team, dict) or team.get("homeAway") not in ("home", "away"):
            continue
        by_side[team["homeAway"]] = team
    result = []
    for side, team_id in (("home", match.home_team_id), ("away", match.away_team_id)):
        team = by_side.get(side)
        if team is None:
            continue
        source_team = team.get("team")
        source_team_name = (
            source_team.get("displayName") or source_team.get("name")
            if isinstance(source_team, dict) else None
        )
        fallback_team_id = match.home_team_id if side == "home" else match.away_team_id
        team_id = (
            _team_id_for_match(source_team_name, match, team_names_by_id)
            if source_team_name else None
        ) or fallback_team_id
        if team_id is None:
            raise ValueError("Resumo ESPN não identifica um dos times.")
        stats = _stat_values(team.get("statistics"))
        raw = {
            entry["name"]: entry.get("displayValue", entry.get("value"))
            for entry in team.get("statistics", [])
            if isinstance(entry, dict) and entry.get("name") in TEAM_RAW_STATS
        }
        mapped = {
            field: stats[stat]
            for stat, field in TEAM_STAT_FIELDS.items()
            if stat in stats
        }
        result.append({
            "team_id": team_id,
            "is_home": side == "home",
            "raw": raw,
            "mapped": mapped,
        })
    if len(result) != 2:
        raise ValueError("Resumo ESPN não trouxe estatísticas para os dois times.")
    return result


def _merge_provider_stats(row: Any, source: str, values: Mapping[str, Any]) -> None:
    supplemental = _source_bucket(row.supplemental_stats)
    supplemental[source] = dict(values)
    row.supplemental_stats = supplemental


def _apply_missing_values(row: Any, values: Mapping[str, Any]) -> None:
    for field, value in values.items():
        if hasattr(row, field) and value is not None and getattr(row, field) in (None, 0):
            setattr(row, field, value)


def _upsert_player(
    db: Session,
    match: Match,
    team_id: int,
    player: Player,
    starter: bool | None,
    stats: Mapping[str, int | float],
    existing: PlayerMatchStatistics | None,
) -> tuple[bool, PlayerMatchStatistics]:
    created = existing is None
    if existing is None:
        existing = PlayerMatchStatistics(
            match_id=match.id,
            player_id=player.id,
            team_id=team_id,
            is_starter=bool(starter),
        )
        db.add(existing)
    elif starter is True:
        existing.is_starter = True
    raw = {key: value for key, value in stats.items() if key in PLAYER_RAW_STATS}
    mapped = {
        field: stats[key]
        for key, field in PLAYER_STAT_FIELDS.items()
        if key in stats
    }
    _merge_provider_stats(existing, "espn", {"raw": raw, "mapped": mapped})
    _apply_missing_values(existing, mapped)
    return created, existing


def _upsert_team_match(
    db: Session,
    match: Match,
    source: Mapping[str, Any],
    existing: TeamMatchStatistics | None,
) -> tuple[bool, TeamMatchStatistics]:
    created = existing is None
    if existing is None:
        existing = TeamMatchStatistics(
            match_id=match.id,
            team_id=source["team_id"],
            is_home=source["is_home"],
        )
        db.add(existing)
    _merge_provider_stats(existing, "espn", {
        "raw": source["raw"],
        "mapped": source["mapped"],
    })
    _apply_missing_values(existing, source["mapped"])
    return created, existing


def _team_id_for_match(
    name: str | None,
    match: Match,
    team_names_by_id: Mapping[int, str],
) -> int | None:
    if not name:
        return None
    home_name = team_names_by_id.get(match.home_team_id)
    away_name = team_names_by_id.get(match.away_team_id)
    home_match = home_name is not None and _same_espn_team_name(name, home_name)
    away_match = away_name is not None and _same_espn_team_name(name, away_name)
    if home_match == away_match:
        return None
    return match.home_team_id if home_match else match.away_team_id


def sync_espn_rows(
    db: Session,
    league_code: str,
    schedule_rows: list[dict[str, Any]],
    summaries: Mapping[str, Mapping[str, Any]],
    matched_game_ids: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    """Apply parsed ESPN summaries to existing finished matches, idempotently."""
    if matched_game_ids is None:
        game_matches, _, summary = _match_schedule(db, league_code, schedule_rows)
    else:
        match_ids = set(matched_game_ids.values())
        matches = db.scalars(select(Match).where(Match.id.in_(match_ids))).all()
        matches_by_id = {match.id: match for match in matches}
        game_matches = {
            game_id: matches_by_id[match_id]
            for game_id, match_id in matched_game_ids.items()
            if match_id in matches_by_id
        }
        summary = {
            "matches_matched": len(game_matches),
            "matches_unmatched": 0,
            "matches_ambiguous": 0,
        }
    team_ids = {
        team_id
        for match in game_matches.values()
        for team_id in (match.home_team_id, match.away_team_id)
    }
    team_names_by_id = {
        team.id: team.name
        for team in db.scalars(select(Team).where(Team.id.in_(team_ids))).all()
    }
    match_ids = {match.id for match in game_matches.values()}
    lineups_by_key = {
        (row.match_id, row.team_id, row.player_id): row
        for row in db.scalars(
            select(Lineup).where(Lineup.match_id.in_(match_ids))
        ).all()
    }
    player_stats_by_key = {
        (row.match_id, row.player_id): row
        for row in db.scalars(
            select(PlayerMatchStatistics).where(
                PlayerMatchStatistics.match_id.in_(match_ids)
            )
        ).all()
    }
    team_stats_by_key = {
        (row.match_id, row.team_id): row
        for row in db.scalars(
            select(TeamMatchStatistics).where(
                TeamMatchStatistics.match_id.in_(match_ids)
            )
        ).all()
    }
    resolver = PlayerResolver(db)
    totals = {
        "lineups_inserted": 0,
        "lineups_skipped": 0,
        "player_match_stats_inserted": 0,
        "player_match_stats_skipped": 0,
        "team_match_stats_inserted": 0,
        "team_match_stats_skipped": 0,
        "players_unmatched": 0,
        "summaries_missing": 0,
    }
    for schedule in schedule_rows:
        game_id = str(schedule.get("game_id") or "")
        match = game_matches.get(game_id)
        if match is None or match.status != "finished":
            continue
        payload = summaries.get(game_id)
        if payload is None:
            totals["summaries_missing"] += 1
            continue
        try:
            lineups, player_rows = _roster_rows(payload, match, team_names_by_id)
            team_rows = _boxscore_rows(payload, match, team_names_by_id)
        except ValueError as error:
            totals.setdefault("summary_errors", {})[game_id] = str(error)
            continue
        lineup_by_player: dict[int, bool | None] = {}
        resolved_player_rows: list[tuple[int, Player, Mapping[str, Any]]] = []
        for lineup in lineups:
            team_id = _team_id_for_match(lineup["team"], match, team_names_by_id)
            player = resolver.resolve(team_id, lineup["player"]) if team_id else None
            if not team_id or not player:
                totals["players_unmatched"] += 1
                totals["lineups_skipped"] += 1
                continue
            key = (match.id, team_id, player.id)
            existing_lineup = lineups_by_key.get(key)
            starter = bool(lineup["is_starter"])
            shirt_number = lineup.get("jersey_number")
            position = lineup.get("position")
            minutes = lineup.get("minutes_played")
            inserted = existing_lineup is None
            if existing_lineup is None:
                existing_lineup = Lineup(
                    match_id=match.id,
                    team_id=team_id,
                    player_id=player.id,
                    is_starter=starter,
                    shirt_number=shirt_number,
                    position=position,
                    minutes_played=minutes,
                )
                db.add(existing_lineup)
                lineups_by_key[key] = existing_lineup
            else:
                if existing_lineup.shirt_number is None:
                    existing_lineup.shirt_number = shirt_number
                if existing_lineup.position is None:
                    existing_lineup.position = position
                if existing_lineup.minutes_played is None:
                    existing_lineup.minutes_played = minutes
            totals["lineups_inserted"] += int(inserted)
            lineup_by_player[player.id] = starter
        for source in player_rows:
            team_id = _team_id_for_match(source["team"], match, team_names_by_id)
            player = resolver.resolve(team_id, source["player"]) if team_id else None
            if not team_id or not player:
                totals["players_unmatched"] += 1
                totals["player_match_stats_skipped"] += 1
                continue
            resolved_player_rows.append((team_id, player, source["stats"]))
        for team_id, player, stats in resolved_player_rows:
            key = (match.id, player.id)
            created, player_match_stats = _upsert_player(
                db, match, team_id, player,
                lineup_by_player.get(player.id), stats,
                player_stats_by_key.get(key),
            )
            totals["player_match_stats_inserted"] += int(created)
            player_stats_by_key[key] = player_match_stats
        for source in team_rows:
            key = (match.id, source["team_id"])
            created, team_match_stats = _upsert_team_match(
                db, match, source, team_stats_by_key.get(key),
            )
            totals["team_match_stats_inserted"] += int(created)
            team_stats_by_key[key] = team_match_stats
        totals["player_match_stats_skipped"] += max(
            0, len(player_rows) - len(resolved_player_rows),
        )
    db.flush()
    return {**summary, **totals}


def _season_match_targets(
    db: Session,
    league_code: str,
    season: str,
) -> dict[int, Match]:
    start_year = int(season[:4])
    start, end = date(start_year, 7, 1), date(start_year + 1, 7, 1)
    home_alias, away_alias = aliased(Team), aliased(Team)
    matches = db.execute(
        select(Match, home_alias.name, away_alias.name)
        .join(home_alias, home_alias.id == Match.home_team_id)
        .join(away_alias, away_alias.id == Match.away_team_id)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(
            Match.kickoff_time >= datetime.combine(start, datetime.min.time()),
            Match.kickoff_time < datetime.combine(end, datetime.min.time()),
            Competition.code == league_code,
        )
    ).all()
    targets: list[tuple[Match, str, str]] = []
    for match, home_name, away_name in matches:
        target = _target_match(match, db)
        if target.status == "finished" and start <= target.kickoff_time.date() < end:
            if target.id == match.id:
                target_home, target_away = home_name, away_name
            else:
                home, away = db.get(Team, target.home_team_id), db.get(Team, target.away_team_id)
                if home is None or away is None:
                    continue
                target_home, target_away = home.name, away.name
            duplicate_index = next(
                (
                    index for index, (existing, existing_home, existing_away) in enumerate(targets)
                    if _same_fixture(
                        target, target_home, target_away,
                        existing, existing_home, existing_away,
                    )
                ),
                None,
            )
            if duplicate_index is None:
                targets.append((target, target_home, target_away))
            elif _data_source_priority(target.data_source) < _data_source_priority(
                targets[duplicate_index][0].data_source
            ):
                targets[duplicate_index] = (target, target_home, target_away)
    return {match.id: match for match, _, _ in targets}


def _match_reversed_schedule_rows(
    db: Session,
    league_code: str,
    season: str,
    schedule_rows: list[dict[str, Any]],
    targets: Mapping[int, Match] | None = None,
) -> dict[str, Match]:
    if targets is None:
        targets = _season_match_targets(db, league_code, season)
    if not targets:
        return {}
    team_ids = {
        team_id
        for match in targets.values()
        for team_id in (match.home_team_id, match.away_team_id)
    }
    team_names = {
        team.id: team.name
        for team in db.scalars(select(Team).where(Team.id.in_(team_ids))).all()
    }
    target_rows = [
        (match, team_names.get(match.home_team_id), team_names.get(match.away_team_id))
        for match in targets.values()
    ]
    result: dict[str, Match] = {}
    for source in schedule_rows:
        game_id = str(source.get("game_id") or "")
        source_date = _source_date(source)
        source_home = str(source.get("home_team") or "")
        source_away = str(source.get("away_team") or "")
        source_score = _score(source.get("score"))
        if not game_id or source_date is None or not source_home or not source_away:
            continue
        candidates: list[tuple[int, int, Match]] = []
        for match, home_name, away_name in target_rows:
            if not home_name or not away_name:
                continue
            if not (
                _same_espn_team_name(source_home, away_name)
                and _same_espn_team_name(source_away, home_name)
            ):
                continue
            date_distance = abs(match.kickoff_time.date() - source_date)
            if date_distance > MATCH_DATE_TOLERANCE:
                continue
            distance = date_distance.days
            if (
                source_score
                and match.home_score is not None
                and match.away_score is not None
                and source_score != (match.away_score, match.home_score)
            ):
                continue
            candidates.append((
                distance, _data_source_priority(match.data_source), match,
            ))
        if not candidates:
            continue
        best_distance = min(distance for distance, _, _ in candidates)
        best_priority = min(
            priority for distance, priority, _ in candidates
            if distance == best_distance
        )
        best = [
            match for distance, priority, match in candidates
            if distance == best_distance and priority == best_priority
        ]
        if len(best) == 1:
            result[game_id] = best[0]
    return result


def _finished_match_dates(
    db: Session,
    league_code: str,
    season: str,
) -> list[date]:
    targets = _season_match_targets(db, league_code, season)
    return sorted({match.kickoff_time.date() for match in targets.values()})


def _finished_match_count(db: Session, league_code: str, season: str) -> int:
    return len(_season_match_targets(db, league_code, season))


def _store_checkpoint(
    db: Session,
    resource: str,
    summary: dict[str, Any],
    *,
    success: bool,
) -> None:
    checkpoint = db.scalar(
        select(CollectionState).where(
            CollectionState.provider == "espn",
            CollectionState.resource == resource,
        )
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if checkpoint is None:
        checkpoint = CollectionState(
            provider="espn", resource=resource, status="partial",
        )
        db.add(checkpoint)
    checkpoint.summary = summary
    checkpoint.status = "success" if success else "partial"
    if success:
        checkpoint.last_success_at = now


def _sync_league(
    league_code: str,
    season: str,
    *,
    delay: float = DEFAULT_DELAY,
    cache_dir: Path | None = None,
) -> dict[str, Any]:
    client = ESPNClient(cache_dir, delay=delay)
    with SessionLocal() as db:
        targets = _season_match_targets(db, league_code, season)
        dates = sorted({match.kickoff_time.date() for match in targets.values()})
        expected_matches = len(targets)
        schedule_rows: list[dict[str, Any]] = []
        events_by_id: dict[str, Mapping[str, Any]] = {}
        query_dates = sorted({
            candidate
            for day in dates
            for candidate in (day - timedelta(days=1), day, day + timedelta(days=1))
        })
        rows_by_id: dict[str, dict[str, Any]] = {}
        for day in query_dates:
            payload = client.scoreboard(league_code, day)
            for event in payload.get("events", []):
                if not isinstance(event, dict):
                    continue
                row = _event_schedule_row(event, season)
                if row is not None:
                    rows_by_id[row["game_id"]] = row
                    events_by_id[row["game_id"]] = event
        schedule_rows = list(rows_by_id.values())
        aliases_aligned = _align_schedule_team_names(
            db, league_code, season, schedule_rows,
        )
        game_matches, _, matching = _match_schedule(db, league_code, schedule_rows)
        unmatched_rows = [
            row for row in schedule_rows
            if str(row.get("game_id") or "") not in game_matches
        ]
        reversed_matches = _match_reversed_schedule_rows(
            db, league_code, season, unmatched_rows, targets,
        )
        game_matches.update(reversed_matches)
        matching["matches_matched"] += len(reversed_matches)
        matching["matches_unmatched"] -= len(reversed_matches)
        matching["matches_reversed"] = len(reversed_matches)
        best_event_for_match: dict[int, tuple[int, str]] = {}
        for game_id, match in game_matches.items():
            if match.status != "finished" or not _event_is_complete(events_by_id[game_id]):
                continue
            raw_date = events_by_id[game_id].get("date")
            distance = (
                abs((date.fromisoformat(str(raw_date)[:10]) - match.kickoff_time.date()).days)
                if raw_date else 2
            )
            current = best_event_for_match.get(match.id)
            if current is None or (distance, game_id) < current:
                best_event_for_match[match.id] = (distance, game_id)
        matched_finished = [
            game_id for _, game_id in best_event_for_match.values()
        ]
        schedule_rows = [rows_by_id[game_id] for game_id in matched_finished]
        events_by_id = {game_id: events_by_id[game_id] for game_id in matched_finished}
        linked_match_ids = {
            match_id for match_id in best_event_for_match
        }

    result: dict[str, Any] = dict(matching)
    result["team_aliases_aligned"] = aliases_aligned
    result["matches_expected"] = expected_matches
    result["matches_linked"] = len(linked_match_ids)
    result["matches_unmatched_in_database"] = max(
        0, expected_matches - len(linked_match_ids),
    )
    failures: list[dict[str, str]] = []
    schedule_by_id = {row["game_id"]: row for row in schedule_rows}
    batch_summaries: dict[str, Mapping[str, Any]] = {}
    batch_ids: list[str] = []

    def persist_batch() -> None:
        if not batch_ids:
            return
        batch_schedule = [schedule_by_id[event_id] for event_id in batch_ids]
        with SessionLocal.begin() as db:
            batch_result = sync_espn_rows(
                db,
                league_code,
                batch_schedule,
                batch_summaries,
                {
                    event_id: game_matches[event_id].id
                    for event_id in batch_ids
                },
            )
            for key, value in batch_result.items():
                if key in {"matches_matched", "matches_unmatched", "matches_ambiguous"}:
                    continue
                if key == "summary_errors":
                    result.setdefault(key, {}).update(value)
                    failed_ids = {failure["event_id"] for failure in failures}
                    failures.extend(
                        {"event_id": event_id, "error": error}
                        for event_id, error in value.items()
                        if event_id not in failed_ids
                    )
                elif isinstance(value, int):
                    result[key] = result.get(key, 0) + value
            result["summaries_failed"] = len(failures)
            _store_checkpoint(
                db,
                f"{league_code}:{season}",
                {
                    **{key: value for key, value in result.items() if isinstance(value, int)},
                    "failed_events": list(failures),
                },
                success=False,
            )
        batch_summaries.clear()
        batch_ids.clear()

    for event_id in matched_finished:
        try:
            batch_summaries[event_id] = client.summary(event_id)
            batch_ids.append(event_id)
        except requests.RequestException as error:
            logger.error("ESPN summary failed for %s: %s", event_id, error)
            failures.append({"event_id": event_id, "error": str(error)})
        if len(batch_ids) >= 10:
            persist_batch()
    persist_batch()

    with SessionLocal.begin() as db:
        if db.get_bind().dialect.name == "postgresql":
            from sqlalchemy import text

            locked = db.scalar(text("SELECT pg_try_advisory_xact_lock(73626821)"))
            if not locked:
                raise RuntimeError("Outra importação ESPN está gravando; tente novamente.")
        result["summaries_failed"] = len(failures)
        success = (
            not failures
            and not result.get("summary_errors")
            and result["matches_unmatched_in_database"] == 0
        )
        _store_checkpoint(
            db, f"{league_code}:{season}",
            {
                **{key: value for key, value in result.items() if isinstance(value, int)},
                "failed_events": list(failures),
            },
            success=success,
        )
    return {
        "league": league_code,
        "season": season,
        **result,
        "failed_events": failures,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Complementa partidas existentes com escalações e estatísticas ESPN.",
    )
    parser.add_argument("--leagues", nargs="+", required=True, choices=sorted(ESPN_LEAGUES))
    parser.add_argument("--season", required=True, help="Temporada, por exemplo 2026-27.")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args(argv)
    results = [
        _sync_league(
            league, args.season, delay=args.delay, cache_dir=args.cache_dir,
        )
        for league in args.leagues
    ]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0 if all(
        not item["failed_events"]
        and item["matches_unmatched_in_database"] == 0
        for item in results
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
