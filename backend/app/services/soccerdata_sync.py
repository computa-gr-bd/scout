"""Complement existing match and player records with FBref data via SoccerData.

Run manually from ``backend``:
    python -m app.services.soccerdata_sync --leagues PL PD BL1 SA FL1 --season 2026-27
    python -m app.services.soccerdata_sync --leagues PL PD BL1 SA FL1 --season 2026-27 --season-only

Only fixtures and players already present in the database are linked. Ambiguous
matches or player names are skipped rather than creating duplicate entities.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import json
import math
import re
import sys
from typing import Any, Iterable, Mapping

import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.orm import Session, aliased

from app.db import SessionLocal
from app.db.models import (
    CollectionState, Competition, Lineup, Match, Player, PlayerMatchStatistics,
    PlayerStatistics, Season, Team,
)
from app.services.fbref_stats import (
    COLUMN_BACKED_FIELDS, extract_keeper_match, extract_season_stats, finalize_totals, merge_totals, summarize_table,
)
from app.services.studio import _player_name, _same_person, _same_team_name, norm_person, norm_team

FBREF_LEAGUES = {
    "PL": "ENG-Premier League",
    "PD": "ESP-La Liga",
    "BL1": "GER-Bundesliga",
    "SA": "ITA-Serie A",
    "FL1": "FRA-Ligue 1",
}
MATCH_DATE_TOLERANCE = timedelta(days=1)
DATA_SOURCE_PRIORITY = {
    "understat": 0,
    "football_data": 1,
    "statsbomb": 2,
    "api_football": 3,
    "manual": 4,
}
MATCH_STAT_FIELDS = {
    "goals": ("Gls", "performance"),
    "assists": ("Ast", "performance"),
    "shots": ("Sh", "performance"),
    "shots_on_target": ("SoT", "performance"),
    "tackles": ("TklW", "performance"),
    "interceptions": ("Int", "performance"),
    "fouls_committed": ("Fls", "performance"),
    "fouls_suffered": ("Fld", "performance"),
}
SEASON_STAT_FIELDS = {
    "matches_played": (("MP",), "playing time"),
    "minutes_played": (("Min",), "playing time"),
    "starts": (("Starts",), "playing time"),
    "goals": (("Gls",), "performance"),
    "assists": (("Ast",), "performance"),
}
DEFENSIVE_SEASON_FIELDS = {
    "tackles": (("TklW",), "performance"),
    "interceptions": (("Int",), "performance"),
    "clearances": (("Clr",), "performance"),
    "aerials_won": (("Won",), "aerial"),
    "aerials_lost": (("Lost",), "aerial"),
}


# SoccerData 2026.43.0 supports these season tables. Defensive actions are in
# ``misc``; advanced defense and keeper tables are not exposed by this reader.
EXTRA_SEASON_STAT_TYPES = ("keeper",)
PROBE_STAT_TYPES = ("standard", "misc", "keeper", "shooting", "playing_time")
PLAYER_STAT_COLUMNS = frozenset(PlayerStatistics.__table__.columns.keys())


def _records(frame: Any) -> list[dict[Any, Any]]:
    if frame is None:
        return []
    if hasattr(frame, "reset_index"):
        frame = frame.reset_index()
    if hasattr(frame, "to_dict"):
        records = frame.to_dict(orient="records")
    else:
        records = [dict(row) for row in frame]
    normalized_records = []
    for record in records:
        normalized = {}
        for key, value in record.items():
            if isinstance(key, tuple):
                parts = tuple(part for part in key if part not in (None, ""))
                key = parts[0] if len(parts) == 1 else parts
            normalized[key] = value
        normalized_records.append(normalized)
    return normalized_records


def _attach_game_ids(
    rows: list[dict[Any, Any]],
    schedule_rows: list[dict[Any, Any]],
) -> list[dict[Any, Any]]:
    game_ids = {
        game: game_id
        for row in schedule_rows
        if (game := _row_text(row, "game")) is not None
        and (game_id := _row_text(row, "game_id")) is not None
    }
    return [
        {
            **row,
            "game_id": _row_text(row, "game_id") or game_ids.get(_row_text(row, "game")),
        }
        for row in rows
    ]


def _missing(value: Any) -> bool:
    return value is None or bool(pd.isna(value))


def _key_parts(key: Any) -> tuple[str, ...]:
    parts = key if isinstance(key, tuple) else (key,)
    return tuple(re.sub(r"[^a-z0-9]+", " ", str(part).lower()).strip() for part in parts)


def _column_value(
    row: Mapping[Any, Any],
    aliases: Iterable[str],
    preferred_group: str | None = None,
) -> Any:
    alias_set = {re.sub(r"[^a-z0-9]+", " ", alias.lower()).strip() for alias in aliases}
    candidates: list[tuple[int, Any]] = []
    for key, value in row.items():
        parts = _key_parts(key)
        if not parts or parts[-1] not in alias_set or _missing(value):
            continue
        preferred = int(preferred_group is not None and any(
            preferred_group in part for part in parts[:-1]
        ))
        candidates.append((preferred, value))
    if not candidates:
        return None
    candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    return candidates[0][1]


def _number(value: Any) -> int | None:
    if _missing(value):
        return None
    if isinstance(value, str):
        text_value = value.strip().replace(",", "")
        added_time = re.fullmatch(r"(\d+)\s*\+\s*(\d+)", text_value)
        if added_time:
            return int(added_time.group(1)) + int(added_time.group(2))
        value = text_value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(round(number))


def _row_number(
    row: Mapping[Any, Any],
    aliases: Iterable[str],
    preferred_group: str | None = None,
) -> int | None:
    return _number(_column_value(row, aliases, preferred_group))


def _row_text(row: Mapping[Any, Any], key: str) -> str | None:
    value = row.get(key)
    if _missing(value):
        return None
    value = str(value).strip()
    return value or None


def _source_date(row: Mapping[Any, Any]) -> date | None:
    value = row.get("date")
    if not _missing(value):
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        parsed = pd.to_datetime(value, errors="coerce")
        if not pd.isna(parsed):
            return parsed.date()
    report = row.get("match_report")
    if not _missing(report):
        report_date = re.search(
            r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)"
            r"-\d{1,2}-\d{4}\b",
            str(report),
            flags=re.IGNORECASE,
        )
        if report_date:
            try:
                return datetime.strptime(report_date.group(), "%B-%d-%Y").date()
            except ValueError:
                pass
    game = _row_text(row, "game") or ""
    date_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", game)
    return date.fromisoformat(date_match.group()) if date_match else None


def _source_season_start_year(value: Any) -> int | None:
    if _missing(value):
        return None
    for token in re.findall(r"\d+", str(value)):
        if len(token) >= 4 and token.startswith(("19", "20")):
            return int(token[:4])
        if len(token) == 4:
            return 2000 + int(token[:2])
        if len(token) == 2:
            return 2000 + int(token)
    return None


def _score(value: Any) -> tuple[int, int] | None:
    if _missing(value):
        return None
    match = re.search(r"^\s*(\d+)\s*[-–−\ufffd]\s*(\d+)", str(value))
    return (int(match.group(1)), int(match.group(2))) if match else None


def _schedule_from_html_table(table: Any, league: str, season: str) -> pd.DataFrame:
    records: list[dict[str, Any]] = []
    for row in table.xpath("./tbody/tr"):
        values = {
            cell.get("data-stat"): " ".join("".join(cell.itertext()).split())
            for cell in row.xpath("./th|./td")
            if cell.get("data-stat")
        }
        home, away = values.get("home_team"), values.get("away_team")
        if not home or not away:
            continue
        report_links = row.xpath("./td[@data-stat='match_report']//a/@href")
        match_report = report_links[0] if report_links else None
        game_match = re.search(r"/matches/([^/]+)", match_report or "")
        game_id = game_match.group(1) if game_match else None
        game = game_id or f"{season}-{values.get('gameweek', '')}-{home}-{away}"
        records.append({
            **values,
            "league": league,
            "season": season,
            "game": game,
            "game_id": game_id,
            "match_report": match_report,
        })
    if not records:
        raise RuntimeError(f"FBref schedule table is empty for {league} {season}.")
    return pd.DataFrame(records).set_index(["league", "season", "game"]).sort_index()


def _schedule_from_cached_html(reader: Any) -> pd.DataFrame:
    from lxml import html

    frames = []
    for (league, season), season_info in reader.read_seasons(split_up_big5=True).iterrows():
        path = reader.data_dir / f"schedule_{league}_{season}.html"
        tree = html.parse(str(path))
        tables = tree.xpath("//table[contains(@id, 'sched')]")
        competition = re.search(r"/comps/(\d+)", str(season_info["url"]))
        table = next(
            (
                candidate for candidate in tables
                if competition and re.search(
                    rf"_{re.escape(competition.group(1))}(?:_|$)",
                    candidate.get("id", ""),
                )
            ),
            None,
        )
        if table is None:
            raise RuntimeError(f"No FBref schedule table found for {league} {season}.")
        frames.append(_schedule_from_html_table(table, league, season))
    if not frames:
        raise RuntimeError("FBref did not return any schedule seasons.")
    return pd.concat(frames).sort_index()


def _target_match(match: Match, db: Session) -> Match:
    if match.canonical_match_id is None:
        return match
    return db.get(Match, match.canonical_match_id) or match


def _finished_game_ids(game_matches: Mapping[str, Match]) -> list[str]:
    return [
        game_id for game_id, match in game_matches.items()
        if match.status == "finished"
    ]


def _data_source_priority(source: Any) -> int:
    value = getattr(source, "value", source)
    return DATA_SOURCE_PRIORITY.get(str(value), 99)


def _match_schedule(
    db: Session,
    league_code: str,
    schedule_rows: list[dict[Any, Any]],
) -> tuple[dict[str, Match], dict[str, set[tuple[int, int]]], dict[str, int]]:
    source_seasons = {
        _source_season_start_year(source.get("season"))
        for source in schedule_rows
    }
    valid_seasons = sorted(year for year in source_seasons if year is not None)
    match_filters = [Competition.code == league_code]
    if valid_seasons:
        match_filters.extend((
            Match.kickoff_time >= datetime.combine(
                date(valid_seasons[0], 7, 1), datetime.min.time(),
            ),
            Match.kickoff_time < datetime.combine(
                date(valid_seasons[-1] + 1, 7, 1), datetime.min.time(),
            ),
        ))
    home_alias = aliased(Team)
    away_alias = aliased(Team)
    rows = db.execute(
        select(Match, home_alias.name, away_alias.name)
        .join(home_alias, home_alias.id == Match.home_team_id)
        .join(away_alias, away_alias.id == Match.away_team_id)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(*match_filters)
    ).all()

    candidates: list[tuple[Match, str, str]] = []
    for match, home_name, away_name in rows:
        target = _target_match(match, db)
        candidates.append((target, norm_team(home_name), norm_team(away_name)))

    fixtures_by_game: dict[str, Match] = {}
    team_context: dict[str, set[tuple[int, int]]] = defaultdict(set)
    summary = {"matches_matched": 0, "matches_unmatched": 0, "matches_ambiguous": 0}
    for season_start_year in source_seasons - {None}:
        season_start = date(season_start_year, 7, 1)
        season_end = date(season_start_year + 1, 7, 1)
        context_priorities: dict[str, int] = {}
        for match, home_name, away_name in candidates:
            if not season_start <= match.kickoff_time.date() < season_end:
                continue
            priority = _data_source_priority(match.data_source)
            for name, team_id in (
                (home_name, match.home_team_id),
                (away_name, match.away_team_id),
            ):
                current_priority = context_priorities.get(name)
                if current_priority is None or priority < current_priority:
                    team_context[name] = {(team_id, match.season_id)}
                    context_priorities[name] = priority
                elif priority == current_priority:
                    team_context[name].add((team_id, match.season_id))

    for source in schedule_rows:
        game_id = _row_text(source, "game_id")
        source_date = _source_date(source)
        season_start_year = _source_season_start_year(source.get("season"))
        source_home = norm_team(_row_text(source, "home_team"))
        source_away = norm_team(_row_text(source, "away_team"))
        if (
            not game_id or not source_home or not source_away
            or (source_date is None and season_start_year is None)
        ):
            summary["matches_unmatched"] += 1
            continue

        source_score = _score(source.get("score"))
        matches_by_id: dict[int, tuple[int, int, Match]] = {}
        for match, home_name, away_name in candidates:
            if not (
                _same_team_name(source_home, home_name)
                and _same_team_name(source_away, away_name)
            ):
                continue
            match_date = match.kickoff_time.date()
            if source_date is not None:
                if abs(match_date - source_date) > MATCH_DATE_TOLERANCE:
                    continue
                distance = abs((match_date - source_date).days)
            else:
                season_start = date(season_start_year, 7, 1)
                season_end = date(season_start_year + 1, 7, 1)
                if not season_start <= match_date < season_end:
                    continue
                distance = 0
            if source_score and match.home_score is not None and match.away_score is not None:
                if source_score != (match.home_score, match.away_score):
                    continue
            priority = _data_source_priority(match.data_source)
            current = matches_by_id.get(match.id)
            if current is None or (distance, priority) < current[:2]:
                matches_by_id[match.id] = (distance, priority, match)

        if not matches_by_id:
            summary["matches_unmatched"] += 1
            continue
        best_distance = min(distance for distance, _, _ in matches_by_id.values())
        best_priority = min(
            priority for distance, priority, _ in matches_by_id.values()
            if distance == best_distance
        )
        best = [
            match for distance, priority, match in matches_by_id.values()
            if distance == best_distance and priority == best_priority
        ]
        if len(best) != 1:
            summary["matches_ambiguous"] += 1
            continue

        match = best[0]
        fixtures_by_game[game_id] = match
        team_context[source_home].add((match.home_team_id, match.season_id))
        team_context[source_away].add((match.away_team_id, match.season_id))
        summary["matches_matched"] += 1
    return fixtures_by_game, team_context, summary


def _team_for_row(
    row: Mapping[Any, Any],
    team_context: Mapping[str, set[tuple[int, int]]],
) -> tuple[int, int] | None:
    name = _row_text(row, "team")
    if not name:
        return None
    team_key = norm_team(name)
    contexts = {
        context
        for context_name, team_contexts in team_context.items()
        if _same_team_name(team_key, context_name)
        for context in team_contexts
    }
    return next(iter(contexts)) if len(contexts) == 1 else None


def _team_in_match(name: str | None, match: Match, db: Session) -> int | None:
    if not name:
        return None
    home, away = db.get(Team, match.home_team_id), db.get(Team, match.away_team_id)
    home_match = home is not None and _same_team_name(norm_team(name), norm_team(home.name))
    away_match = away is not None and _same_team_name(norm_team(name), norm_team(away.name))
    if home_match == away_match:
        return None
    return match.home_team_id if home_match else match.away_team_id


class PlayerResolver:
    def __init__(self, db: Session):
        teams = list(db.scalars(select(Team)).all())
        players = list(db.scalars(select(Player).where(Player.team_id.is_not(None))).all())
        players_by_team: dict[int, list[Player]] = defaultdict(list)
        for player in players:
            if player.team_id is not None:
                players_by_team[player.team_id].append(player)

        self.related_ids: dict[int, list[int]] = {}
        self.players_by_team = players_by_team
        for team in teams:
            team_key = norm_team(team.name)
            self.related_ids[team.id] = [
                other.id for other in teams
                if _same_team_name(team_key, norm_team(other.name))
            ]

    @staticmethod
    def _select(candidates: list[Player], canonical_team_id: int) -> Player | None:
        if not candidates:
            return None
        canonical = [player for player in candidates if player.team_id == canonical_team_id]
        if len(canonical) == 1:
            return canonical[0]
        candidates = canonical or candidates
        if len(candidates) == 1:
            return candidates[0]

        best_priority = min(
            _data_source_priority(player.data_source)
            for player in candidates
        )
        preferred = [
            player for player in candidates
            if _data_source_priority(player.data_source) == best_priority
        ]
        return preferred[0] if len(preferred) == 1 else None

    def resolve(self, team_id: int, name: str | None) -> Player | None:
        if not name:
            return None
        candidates = [
            player
            for related_id in self.related_ids.get(team_id, [])
            for player in self.players_by_team.get(related_id, [])
        ]
        source_name = norm_person(name)
        exact = [
            player for player in candidates
            if norm_person(_player_name(player)) == source_name
        ]
        if exact:
            return self._select(exact, team_id)
        similar = [
            player for player in candidates
            if _same_person(source_name, norm_person(_player_name(player)))
        ]
        return self._select(similar, team_id)


def _source_bucket(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _merge_sourced_stats(
    row: Any,
    source_values: Mapping[str, Any],
    fields: Iterable[str],
    *,
    preserve_existing: bool = False,
) -> None:
    supplemental = _source_bucket(row.supplemental_stats)
    provider_values = _source_bucket(supplemental.get("soccerdata"))
    preserved_values = _source_bucket(supplemental.get("preserved"))
    if preserve_existing:
        for field in fields:
            current = getattr(row, field)
            if current not in (None, 0) and field not in provider_values:
                preserved_values[field] = current
    provider_values.update(source_values)
    supplemental["soccerdata"] = provider_values
    if preserved_values:
        supplemental["preserved"] = preserved_values
    row.supplemental_stats = supplemental
    for field in fields:
        incoming = source_values.get(field)
        current = getattr(row, field)
        if incoming is not None and (current is None or current == 0):
            setattr(row, field, incoming)


def _upsert_lineup(
    db: Session,
    match: Match,
    team_id: int,
    player: Player,
    row: Mapping[Any, Any],
) -> tuple[bool, bool | None]:
    is_starter_value = row.get("is_starter")
    is_starter = None if _missing(is_starter_value) else bool(is_starter_value)
    shirt_number = _row_number(row, ("jersey_number", "shirt_number"))
    position = _row_text(row, "position") or _row_text(row, "pos")
    minutes = _row_number(row, ("minutes_played", "min"))
    lineup = db.scalar(
        select(Lineup).where(
            Lineup.match_id == match.id,
            Lineup.team_id == team_id,
            Lineup.player_id == player.id,
        )
    )
    if lineup is None:
        db.add(Lineup(
            match_id=match.id,
            team_id=team_id,
            player_id=player.id,
            is_starter=is_starter if is_starter is not None else False,
            shirt_number=shirt_number,
            position=position,
            minutes_played=minutes,
        ))
        return True, is_starter

    if lineup.shirt_number is None:
        lineup.shirt_number = shirt_number
    if lineup.position is None:
        lineup.position = position
    if lineup.minutes_played is None:
        lineup.minutes_played = minutes
    return False, is_starter


def _upsert_player_match_stats(
    db: Session,
    match: Match,
    team_id: int,
    player: Player,
    row: Mapping[Any, Any],
    lineup_starter: bool | None,
) -> bool:
    source_values = {
        field: _row_number(row, (column,), group)
        for field, (column, group) in MATCH_STAT_FIELDS.items()
    }
    minutes = _row_number(row, ("min", "minutes_played"), "playing time")
    position = _row_text(row, "pos") or _row_text(row, "position")
    existing = db.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.match_id == match.id,
            PlayerMatchStatistics.player_id == player.id,
        )
    )
    created = existing is None
    if existing is None:
        existing = PlayerMatchStatistics(
            match_id=match.id,
            team_id=team_id,
            player_id=player.id,
            minutes_played=minutes or 0,
            is_starter=lineup_starter or False,
            position=position,
        )
        db.add(existing)
    else:
        if not existing.minutes_played and minutes is not None:
            existing.minutes_played = minutes
        if not existing.position and position:
            existing.position = position
        if lineup_starter is True:
            existing.is_starter = True
    _merge_sourced_stats(existing, source_values, MATCH_STAT_FIELDS)
    return created


def _season_stats(
    db: Session,
    player_resolver: PlayerResolver,
    standard_rows: list[dict[Any, Any]],
    misc_rows: list[dict[Any, Any]],
    team_context: Mapping[str, set[tuple[int, int]]],
    extra_rows: Mapping[str, list[dict[Any, Any]]] | None = None,
) -> tuple[int, int]:
    """Soma as estatísticas sazonais por (jogador, temporada) e grava em ``PlayerStatistics``.

    ``extra_rows`` = ``{stat_type: linhas}`` com goleiro/defesa/passes/posse; a tabela ``misc`` é
    reaproveitada para cartões, faltas e bola aérea. Só contagens são guardadas em
    ``supplemental_stats["soccerdata"]`` (percentuais e por-90 saem dos totais na leitura).
    """
    extra_sources: dict[str, list[dict[Any, Any]]] = dict(extra_rows or {})
    extra_sources.setdefault("misc", misc_rows)

    totals: dict[tuple[int, int], dict[str, int]] = defaultdict(dict)
    extra_totals: dict[tuple[int, int], dict[str, float]] = defaultdict(dict)
    unresolved = 0

    def resolve(source: Mapping[Any, Any]) -> tuple[int, int] | None:
        nonlocal unresolved
        team_context_value = _team_for_row(source, team_context)
        player = player_resolver.resolve(
            team_context_value[0],
            _row_text(source, "player"),
        ) if team_context_value else None
        if not player or not team_context_value:
            unresolved += 1
            return None
        return player.id, team_context_value[1]

    # Posição do FBref ("GK", "DF", "DF,MF", "FW") quando o jogador ainda não tem posição.
    for source in standard_rows:
        position = _row_text(source, "pos")
        if not position:
            continue
        context = _team_for_row(source, team_context)
        player = player_resolver.resolve(context[0], _row_text(source, "player")) if context else None
        if player is not None and not player.position:
            player.position = position[:32]

    for rows, field_map in (
        (standard_rows, SEASON_STAT_FIELDS),
        (misc_rows, DEFENSIVE_SEASON_FIELDS),
    ):
        for source in rows:
            key = resolve(source)
            if key is None:
                continue
            for field, (aliases, group) in field_map.items():
                value = _row_number(source, aliases, group)
                if value is not None:
                    totals[key][field] = totals[key].get(field, 0) + value

    for stat_type, rows in extra_sources.items():
        for source in rows:
            values = extract_season_stats(stat_type, source)
            if not values:
                continue
            player_key = _team_for_row(source, team_context)
            player = player_resolver.resolve(
                player_key[0], _row_text(source, "player"),
            ) if player_key else None
            if not player or not player_key:
                # já contado como não resolvido nas tabelas principais; não conta de novo
                continue
            merge_totals(extra_totals[(player.id, player_key[1])], values)

    updated = 0
    for key in set(totals) | set(extra_totals):
        player_id, season_id = key
        extras = finalize_totals(extra_totals.get(key, {}))
        # Totais "padrão" (Min, MP, Gls, Ast) + TklW/Int/Won/Lost da misc; as tabelas extras
        # (ex.: ``defense`` traz Clr, que a ``misc`` NÃO tem) complementam e têm prioridade.
        source_values: dict[str, Any] = {**totals.get(key, {}), **extras}
        existing = db.scalar(
            select(PlayerStatistics).where(
                PlayerStatistics.player_id == player_id,
                PlayerStatistics.season_id == season_id,
                PlayerStatistics.scope == "overall",
            )
        )
        if existing is None:
            existing = PlayerStatistics(
                player_id=player_id,
                season_id=season_id,
                scope="overall",
            )
            db.add(existing)
        column_fields = [field for field in source_values if field in PLAYER_STAT_COLUMNS]
        _merge_sourced_stats(existing, source_values, column_fields, preserve_existing=True)
        # Contagens do FBref com nome diferente da coluna (ex.: pass_cmp -> passes_completed).
        for field, column in COLUMN_BACKED_FIELDS.items():
            incoming = extras.get(field)
            if incoming is None or field in column_fields:
                continue
            if getattr(existing, column) in (None, 0):
                setattr(existing, column, int(incoming))
        pass_att, pass_cmp = extras.get("pass_att"), extras.get("pass_cmp")
        if pass_att and pass_cmp is not None and not existing.pass_accuracy_pct:
            existing.pass_accuracy_pct = round(100.0 * pass_cmp / pass_att, 1)
        updated += 1
    return updated, unresolved


def _upsert_keeper_match_stats(
    db: Session,
    match: Match,
    team_id: int,
    player: Player,
    row: Mapping[Any, Any],
) -> bool:
    """Defesas, gols sofridos e chutes no alvo enfrentados por partida (tabela ``keepers``)."""
    values = extract_keeper_match(row)
    if not values:
        return False
    minutes = _row_number(row, ("min", "minutes_played"), "playing time")
    existing = db.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.match_id == match.id,
            PlayerMatchStatistics.player_id == player.id,
        )
    )
    created = existing is None
    if existing is None:
        existing = PlayerMatchStatistics(
            match_id=match.id,
            team_id=team_id,
            player_id=player.id,
            minutes_played=minutes or 0,
            is_starter=True,
            position="GK",
        )
        db.add(existing)
    else:
        if not existing.minutes_played and minutes is not None:
            existing.minutes_played = minutes
        if not existing.position:
            existing.position = "GK"
    _merge_sourced_stats(
        existing, values, ("saves", "goals_conceded", "shots_faced"),
    )
    return created


def sync_soccerdata_rows(
    db: Session,
    league_code: str,
    schedule_rows: list[dict[Any, Any]],
    lineup_rows: list[dict[Any, Any]],
    player_match_rows: list[dict[Any, Any]],
    player_season_standard_rows: list[dict[Any, Any]],
    player_season_misc_rows: list[dict[Any, Any]],
    player_season_extra_rows: Mapping[str, list[dict[Any, Any]]] | None = None,
    keeper_match_rows: list[dict[Any, Any]] | None = None,
) -> dict[str, Any]:
    if league_code not in FBREF_LEAGUES:
        raise ValueError(f"Liga sem mapeamento FBref: {league_code}")

    game_matches, team_context, summary = _match_schedule(db, league_code, schedule_rows)
    player_resolver = PlayerResolver(db)
    lineup_by_player: dict[tuple[int, int], bool | None] = {}
    summary.update({
        "lineups_inserted": 0,
        "lineups_skipped": 0,
        "player_match_stats_inserted": 0,
        "player_match_stats_skipped": 0,
        "keeper_match_stats_inserted": 0,
        "keeper_match_stats_updated": 0,
        "players_unmatched": 0,
    })

    for source in lineup_rows:
        game_id = _row_text(source, "game_id")
        match = game_matches.get(game_id or "")
        if match is None or match.status != "finished":
            summary["lineups_skipped"] += 1
            continue
        team_id = _team_in_match(_row_text(source, "team"), match, db)
        player = player_resolver.resolve(team_id, _row_text(source, "player")) if team_id else None
        if not team_id or not player:
            summary["players_unmatched"] += 1
            continue
        inserted, starter = _upsert_lineup(db, match, team_id, player, source)
        summary["lineups_inserted"] += int(inserted)
        lineup_by_player[(match.id, player.id)] = starter

    for source in player_match_rows:
        game_id = _row_text(source, "game_id")
        match = game_matches.get(game_id or "")
        if match is None or match.status != "finished":
            summary["player_match_stats_skipped"] += 1
            continue
        team_id = _team_in_match(_row_text(source, "team"), match, db)
        player = player_resolver.resolve(team_id, _row_text(source, "player")) if team_id else None
        if not team_id or not player:
            summary["players_unmatched"] += 1
            continue
        created = _upsert_player_match_stats(
            db, match, team_id, player, source,
            lineup_by_player.get((match.id, player.id)),
        )
        summary["player_match_stats_inserted"] += int(created)

    for source in keeper_match_rows or []:
        game_id = _row_text(source, "game_id")
        match = game_matches.get(game_id or "")
        if match is None or match.status != "finished":
            continue
        team_id = _team_in_match(_row_text(source, "team"), match, db)
        player = player_resolver.resolve(team_id, _row_text(source, "player")) if team_id else None
        if not team_id or not player:
            summary["players_unmatched"] += 1
            continue
        created = _upsert_keeper_match_stats(db, match, team_id, player, source)
        summary["keeper_match_stats_inserted" if created else "keeper_match_stats_updated"] += 1

    season_rows_updated, season_players_unmatched = _season_stats(
        db,
        player_resolver,
        player_season_standard_rows,
        player_season_misc_rows,
        team_context,
        player_season_extra_rows,
    )
    summary["player_season_stats_updated"] = season_rows_updated
    summary["season_players_unmatched"] = season_players_unmatched
    db.flush()
    return summary


def _store_checkpoint(
    db: Session,
    resource: str,
    summary: dict[str, Any],
    *,
    status: str = "success",
) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    checkpoint = db.scalar(
        select(CollectionState).where(
            CollectionState.provider == "soccerdata",
            CollectionState.resource == resource,
        )
    )
    if checkpoint is None:
        checkpoint = CollectionState(
            provider="soccerdata",
            resource=resource,
            status=status,
            summary=summary,
            last_success_at=now if status == "success" else None,
        )
        db.add(checkpoint)
    else:
        checkpoint.status = status
        checkpoint.summary = summary
        if status == "success":
            checkpoint.last_success_at = now


def _read_optional(label: str, reader_call: Any, failures: list[str]) -> list[dict[Any, Any]]:
    """Lê uma tabela complementar; deixa a falha explícita sem abortar as demais tabelas."""
    try:
        return _records(reader_call())
    except Exception as error:  # noqa: BLE001 - tabelas extras são "best effort"
        failures.append(label)
        print(f"[soccerdata] aviso: tabela '{label}' indisponível ({type(error).__name__}: {error})", file=sys.stderr)
        return []


def _probe_league(league_code: str, season: str) -> dict[str, Any]:
    """Diagnóstico: quais tabelas de jogador o FBref ainda entrega COM dados (sem gravar nada)."""
    import soccerdata

    reader = soccerdata.FBref(leagues=FBREF_LEAGUES[league_code], seasons=season)
    report: dict[str, Any] = {}
    for stat_type in PROBE_STAT_TYPES:
        try:
            report[stat_type] = summarize_table(_records(reader.read_player_season_stats(stat_type=stat_type)))
        except Exception as error:  # noqa: BLE001
            report[stat_type] = {"error": f"{type(error).__name__}: {error}"}
    return {"league": league_code, "season": season, "tables": report}


def _sync_league(
    league_code: str,
    season: str,
    include_extra: bool = True,
    season_only: bool = False,
) -> dict[str, Any]:
    import soccerdata

    reader = soccerdata.FBref(leagues=FBREF_LEAGUES[league_code], seasons=season)
    try:
        schedule_frame = reader.read_schedule(force_cache=True)
    except KeyError as error:
        if error.args != ("date",):
            raise
        schedule_frame = _schedule_from_cached_html(reader)

    def cached_schedule(force_cache: bool = False) -> pd.DataFrame:
        _ = force_cache
        return schedule_frame.copy()

    setattr(reader, "read_schedule", cached_schedule)
    schedule = _records(schedule_frame)
    matched_game_ids: list[str] = []
    if not season_only:
        with SessionLocal() as db:
            game_matches = _match_schedule(db, league_code, schedule)[0]
            matched_game_ids = _finished_game_ids(game_matches)
    lineups = []
    player_match_stats = []
    if matched_game_ids:
        lineups = _attach_game_ids(
            _records(reader.read_lineup(match_id=matched_game_ids)),
            schedule,
        )
        player_match_stats = _attach_game_ids(
            _records(reader.read_player_match_stats(
                stat_type="summary",
                match_id=matched_game_ids,
            )),
            schedule,
        )
    player_season_standard = _records(reader.read_player_season_stats(stat_type="standard"))
    player_season_misc = _records(reader.read_player_season_stats(stat_type="misc"))
    extra_failures: list[str] = []
    player_season_extra: dict[str, list[dict[Any, Any]]] = {}
    keeper_match_rows: list[dict[Any, Any]] = []
    if include_extra:
        for stat_type in EXTRA_SEASON_STAT_TYPES:
            player_season_extra[stat_type] = _read_optional(
                stat_type,
                lambda stat_type=stat_type: reader.read_player_season_stats(stat_type=stat_type),
                extra_failures,
            )
        if matched_game_ids:
            keeper_match_rows = _attach_game_ids(
                _read_optional(
                    "keepers (partida)",
                    lambda: reader.read_player_match_stats(stat_type="keepers", match_id=matched_game_ids),
                    extra_failures,
                ),
                schedule,
            )
    resource = f"{league_code}:{season}"

    with SessionLocal.begin() as db:
        if db.get_bind().dialect.name == "postgresql":
            locked = db.scalar(text("SELECT pg_try_advisory_xact_lock(73626820)"))
            if not locked:
                raise RuntimeError("Outra importação SoccerData está gravando; tente novamente.")
        summary = sync_soccerdata_rows(
            db,
            league_code,
            schedule,
            lineups,
            player_match_stats,
            player_season_standard,
            player_season_misc,
            player_season_extra,
            keeper_match_rows,
        )
        summary["extra_tables_failed"] = len(extra_failures)
        summary["extra_tables_failed_names"] = extra_failures
        status = "partial" if extra_failures else "success"
        _store_checkpoint(db, resource, summary, status=status)
    return {"league": league_code, "season": season, "status": status, **summary}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Complementa dados existentes com FBref via SoccerData.")
    parser.add_argument("--leagues", nargs="+", required=True, choices=sorted(FBREF_LEAGUES))
    parser.add_argument("--season", required=True, help="Temporada FBref, por exemplo 2026-27.")
    parser.add_argument(
        "--basic-only", action="store_true",
        help="Não lê a tabela complementar de goleiros; só o conjunto básico.",
    )
    parser.add_argument(
        "--probe", action="store_true",
        help="Só diagnostica: mostra quais tabelas do FBref vêm com dados (não grava nada).",
    )
    parser.add_argument(
        "--season-only", action="store_true",
        help="Importa estatísticas sazonais e evita buscar relatórios individuais das partidas.",
    )
    args = parser.parse_args(argv)
    if args.probe:
        print(json.dumps([_probe_league(league, args.season) for league in args.leagues], ensure_ascii=False, indent=2))
        return 0
    results = [
        _sync_league(
            league,
            args.season,
            include_extra=not args.basic_only,
            season_only=args.season_only,
        )
        for league in args.leagues
    ]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
