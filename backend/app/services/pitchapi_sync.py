"""Import PitchAPI match data as a source-aware supplement to existing matches."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import math
import re
import time
from typing import Any, Iterable, Mapping
from urllib.parse import quote

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.db import SessionLocal
from app.db.models import (
    CollectionState, Competition, DataSource, Event, EventPosition, EventType,
    Lineup, Match, PlayerMatchStatistics, Season, Shot, TeamMatchStatistics,
)
from app.services.soccerdata_sync import PlayerResolver
from app.services.studio import _same_team_name, norm_team

BASE_URL = "https://api.pitchapi.dev/v1"
DEFAULT_LEAGUES = ("PL", "PD", "BL1", "SA", "FL1")
PITCH_LENGTH_METERS = 105.0
PITCH_WIDTH_METERS = 68.0
PLAYER_STAT_FIELDS = {
    "assists": "assists",
    "accuratepasses": "passes_completed",
    "expectedassists": "xa",
    "expectedgoals": "xg",
    "interceptions": "interceptions",
    "keypasses": "key_passes",
    "minutes": "minutes_played",
    "minutesplayed": "minutes_played",
    "passes": "passes",
    "passescompleted": "passes_completed",
    "shots": "shots",
    "shotsontarget": "shots_on_target",
    "tackles": "tackles",
    "totalshots": "shots",
    "ratingtitle": "rating",
    "xg": "xg",
    "xa": "xa",
    "goals": "goals",
}
TEAM_STAT_FIELDS = {
    "accuratepasses": "passes_completed",
    "ballpossesion": "possession_pct",
    "ballpossession": "possession_pct",
    "blockedshots": "shots_blocked",
    "clearances": "clearances",
    "corners": "corners",
    "expectedgoals": "xg",
    "fouls": "fouls",
    "interceptions": "interceptions",
    "passes": "passes",
    "saves": "saves",
    "shots": "shots",
    "shotsontarget": "shots_on_target",
    "tackles": "tackles",
    "totalpasses": "passes",
    "totalshots": "shots",
}
TEAM_INTEGER_FIELDS = set(TEAM_STAT_FIELDS.values()) - {"possession_pct", "xg"}
INTEGER_PLAYER_FIELDS = {
    "assists", "passes", "passes_completed", "minutes_played", "key_passes",
    "shots", "shots_on_target", "tackles", "interceptions", "goals",
}
ON_TARGET_RESULTS = {"goal", "attemptsaved", "savedshot"}
BODY_PARTS = {
    "leftfoot": "left foot",
    "rightfoot": "right foot",
    "header": "head",
    "head": "head",
    "otherbodyparts": "other",
    "other": "other",
}


class PitchAPIError(RuntimeError):
    """A provider error that is safe to show without exposing request credentials."""


class PitchAPIRetryableError(PitchAPIError):
    """A temporary provider or network failure; stop issuing further requests."""


class PitchAPIClient:
    def __init__(self, api_key: str, session: Any | None = None, timeout: float = 20):
        if not api_key:
            raise ValueError("Configure PITCH_API_KEY no .env antes de sincronizar.")
        self.session = session or requests.Session()
        self.session.headers.update({"X-API-KEY": api_key, "Accept": "application/json"})
        self.timeout = timeout

    def close(self) -> None:
        self.session.close()

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        for attempt in range(3):
            try:
                response = self.session.get(
                    f"{BASE_URL}/{path.lstrip('/')}",
                    params=params,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                raise PitchAPIRetryableError("Falha de rede ao consultar a PitchAPI.") from exc
            if response.status_code < 500 or attempt == 2:
                break
            time.sleep(0.5 * (2 ** attempt))

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            suffix = f" Tente novamente em {retry_after}s." if retry_after else ""
            raise PitchAPIRetryableError(f"PitchAPI limitou a requisição.{suffix}")
        if response.status_code >= 500:
            raise PitchAPIRetryableError(
                f"PitchAPI respondeu HTTP {response.status_code} em {path}."
            )
        if response.status_code >= 400:
            raise PitchAPIError(f"PitchAPI respondeu HTTP {response.status_code} em {path}.")

        try:
            payload = response.json()
        except ValueError as exc:
            raise PitchAPIError(f"Resposta inválida da PitchAPI em {path}.") from exc
        if not isinstance(payload, dict):
            raise PitchAPIError(f"Resposta inválida da PitchAPI em {path}.")
        if payload.get("error"):
            error = payload["error"]
            message = error.get("message") if isinstance(error, dict) else error
            raise PitchAPIError(f"PitchAPI recusou {path}: {message or 'erro do provedor'}.")
        if "data" not in payload:
            raise PitchAPIError(f"Resposta da PitchAPI sem o campo data em {path}.")
        return payload["data"]

    def fixtures_for_date(self, fixture_date: date) -> list[dict[str, Any]]:
        return _as_rows(
            self.get(f"date/{fixture_date.isoformat()}", {"status": "all"}),
            "matches", "fixtures",
        )

    def lineups(self, match_id: str) -> Any:
        return self.get(f"matches/{quote(match_id, safe='')}/lineups")

    def shots(self, match_id: str) -> Any:
        return self.get(f"matches/{quote(match_id, safe='')}/shots")

    def players(self, match_id: str) -> Any:
        return self.get(f"matches/{quote(match_id, safe='')}/players")

    def statistics(self, match_id: str) -> Any:
        return self.get(f"matches/{quote(match_id, safe='')}/stats")


def _as_rows(data: Any, *keys: str) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in keys:
            rows = data.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    return []


def _text(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("display_name", "displayName", "name", "short_name", "label", "value"):
            if value.get(key) not in (None, ""):
                return str(value[key])
        return None
    return str(value) if value not in (None, "") else None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None else None


def _number(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("value", value.get("total"))
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", "")
        if "/" in value:
            value = value.split("/", 1)[0].strip()
        value = value.removesuffix("%")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "yes", "1", "confirmed"}:
            return True
        if lowered in {"false", "no", "0", "unconfirmed"}:
            return False
    return None


def _team_info(fixture: Mapping[str, Any], side: str) -> tuple[str | None, str | None]:
    sides = fixture.get("teams")
    source = fixture.get(f"{side}_team")
    if source is None and isinstance(sides, dict):
        source = sides.get(side)
    if source is None:
        source = fixture.get(side)
    if isinstance(source, dict):
        external_id = source.get("id", source.get("team_id"))
        name = _text(source)
    else:
        external_id, name = None, _text(source)
    return (str(external_id) if external_id is not None else None, name)


def _fixture_time(fixture: Mapping[str, Any]) -> tuple[datetime | None, bool]:
    raw = next((
        fixture.get(key)
        for key in ("time_utc", "kickoff_time", "date_utc", "date")
        if fixture.get(key)
    ), None)
    if not raw:
        return None, False
    text_value = str(raw)
    has_time = "T" in text_value or " " in text_value
    try:
        value = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
    except ValueError:
        return None, has_time
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value, has_time


def _match_id(fixture: Mapping[str, Any]) -> str | None:
    value = fixture.get("id", fixture.get("match_id"))
    return str(value) if value not in (None, "") else None


def _source_match_key(fixture: Mapping[str, Any], match_id: str) -> str:
    league = fixture.get("league")
    league_id = (
        league.get("id") if isinstance(league, dict)
        else fixture.get("league_id")
    )
    return f"{league_id or 'league'}:{match_id}"


def _fixture_status(fixture: Mapping[str, Any]) -> str:
    return (_text(fixture.get("status")) or "").strip().lower().replace("_", " ")


def _is_finished(fixture: Mapping[str, Any], match: Match) -> bool:
    return match.status == "finished" or _fixture_status(fixture) in {
        "ft", "finished", "full time", "full-time", "completed",
        "after extra time", "after penalties", "aet", "pen",
    }


def _score(fixture: Mapping[str, Any], side: str) -> int | None:
    direct = fixture.get(f"{side}_score", fixture.get(f"score_{side}"))
    if direct is not None:
        return _integer(direct)
    scores = fixture.get("score")
    if isinstance(scores, dict):
        value = scores.get(side)
        if isinstance(value, dict):
            value = value.get("full_time", value.get("current", value.get("total")))
        if value is not None:
            return _integer(value)
        full_time = scores.get("full_time")
        if isinstance(full_time, dict):
            return _integer(full_time.get(side))
    return None


def _fixture_match(
    fixture: Mapping[str, Any],
    candidates: Iterable[Match],
) -> tuple[Match | None, str]:
    home_name = _team_info(fixture, "home")[1]
    away_name = _team_info(fixture, "away")[1]
    kickoff, has_time = _fixture_time(fixture)
    if not home_name or not away_name or kickoff is None:
        return None, "unmatched"
    source_home, source_away = norm_team(home_name), norm_team(away_name)
    matches = []
    for candidate in candidates:
        if candidate.home_team is None or candidate.away_team is None:
            continue
        candidate_date = candidate.kickoff_time.date()
        if abs((candidate_date - kickoff.date()).days) > 1:
            continue
        if has_time and abs(candidate.kickoff_time - kickoff) > timedelta(hours=36):
            continue
        if (
            _same_team_name(source_home, norm_team(candidate.home_team.name))
            and _same_team_name(source_away, norm_team(candidate.away_team.name))
        ):
            matches.append(candidate)
    if len(matches) == 1:
        return matches[0], "matched"
    return None, "ambiguous" if matches else "unmatched"


def _upsert_source_match(db: Session, fixture: Mapping[str, Any], source_key: str, match: Match) -> None:
    source_match = db.scalar(
        select(Match).where(
            Match.data_source == DataSource.PITCH_API,
            Match.external_id == source_key,
        )
    )
    values = {
        "season_id": match.season_id,
        "home_team_id": match.home_team_id,
        "away_team_id": match.away_team_id,
        "kickoff_time": match.kickoff_time,
        "status": _fixture_status(fixture) or match.status,
        "home_score": _score(fixture, "home"),
        "away_score": _score(fixture, "away"),
        "canonical_match_id": match.id,
    }
    if source_match is None:
        db.add(Match(
            external_id=source_key,
            data_source=DataSource.PITCH_API,
            **values,
        ))
    else:
        for key, value in values.items():
            if value is not None:
                setattr(source_match, key, value)
    home_score, away_score = values["home_score"], values["away_score"]
    if (
        (match.status or "").lower() == "scheduled"
        and _is_finished(fixture, match)
        and match.kickoff_time < datetime.now(timezone.utc).replace(tzinfo=None)
        and match.home_score is None and match.away_score is None
        and home_score is not None and away_score is not None
        and home_score >= 0 and away_score >= 0
    ):
        match.status = "finished"
        match.home_score = home_score
        match.away_score = away_score


def _source_team_map(fixture: Mapping[str, Any], match: Match) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for side, team_id in (("home", match.home_team_id), ("away", match.away_team_id)):
        external_id, _ = _team_info(fixture, side)
        if external_id:
            mapping[external_id] = team_id
    return mapping


def _resolve_team_id(
    value: Any,
    fixture: Mapping[str, Any],
    match: Match,
    external_team_ids: Mapping[str, int],
) -> int | None:
    if isinstance(value, dict):
        external_id = value.get("id", value.get("team_id"))
        if external_id is not None and str(external_id) in external_team_ids:
            return external_team_ids[str(external_id)]
        value = _text(value)
    elif value is not None and str(value) in external_team_ids:
        return external_team_ids[str(value)]
    name = _text(value)
    if not name:
        return None
    key = norm_team(name)
    home_name = _team_info(fixture, "home")[1]
    away_name = _team_info(fixture, "away")[1]
    home = home_name is not None and _same_team_name(key, norm_team(home_name))
    away = away_name is not None and _same_team_name(key, norm_team(away_name))
    if home == away:
        return None
    return match.home_team_id if home else match.away_team_id


def _lineup_side(payload: Any, side: str) -> tuple[bool, list[tuple[dict[str, Any], bool]]]:
    if not isinstance(payload, dict):
        return False, []
    side_data = payload.get(side)
    global_confirmed = _boolean(payload.get("confirmed")) is True
    if isinstance(side_data, list):
        confirmed = global_confirmed or _boolean(payload.get(f"{side}_confirmed")) is True
        return confirmed, [
            (row, _boolean(row.get("is_starter", row.get("starter"))) is True)
            for row in side_data if isinstance(row, dict)
        ]
    if not isinstance(side_data, dict):
        return False, []
    confirmed = (
        _boolean(side_data.get("confirmed")) is True
        or global_confirmed
        or _boolean(payload.get(f"{side}_confirmed")) is True
    )
    rows: list[tuple[dict[str, Any], bool]] = []
    for key, starter in (("starters", True), ("substitutes", False), ("subs", False)):
        entries = side_data.get(key)
        if isinstance(entries, list):
            rows.extend((row, starter) for row in entries if isinstance(row, dict))
    if not rows and isinstance(side_data.get("players"), list):
        rows.extend(
            (row, _boolean(row.get("is_starter", row.get("starter"))) is True)
            for row in side_data["players"] if isinstance(row, dict)
        )
    return confirmed, rows


def _player_name(row: Mapping[str, Any]) -> str | None:
    player = row.get("player")
    return (
        _text(row.get("name"))
        or _text(row.get("player_name"))
        or _text(player)
        or _text(row.get("display_name"))
    )


def _upsert_lineups(
    db: Session,
    match: Match,
    payload: Any,
    resolver: PlayerResolver,
) -> dict[str, int]:
    counts = {"inserted": 0, "unmatched_players": 0, "unconfirmed_sides": 0}
    existing = {
        (row.team_id, row.player_id): row
        for row in db.scalars(select(Lineup).where(Lineup.match_id == match.id)).all()
    }
    for side, team_id in (("home", match.home_team_id), ("away", match.away_team_id)):
        confirmed, entries = _lineup_side(payload, side)
        if not confirmed:
            counts["unconfirmed_sides"] += 1
            continue
        for entry, starter in entries:
            player = resolver.resolve(team_id, _player_name(entry))
            if player is None:
                counts["unmatched_players"] += 1
                continue
            key = (team_id, player.id)
            row = existing.get(key)
            shirt_number = _integer(entry.get("shirt_number", entry.get("number")))
            position = _text(entry.get("position"))
            if position and position.isdigit():
                position = None
            formation_position = _text(entry.get("formation_position"))
            minutes = _integer(entry.get("minutes_played"))
            if row is None:
                row = Lineup(
                    match_id=match.id,
                    team_id=team_id,
                    player_id=player.id,
                    is_starter=starter,
                    shirt_number=shirt_number,
                    position=position,
                    formation_position=formation_position,
                    minutes_played=minutes,
                )
                db.add(row)
                existing[key] = row
                counts["inserted"] += 1
            else:
                for field, value in (
                    ("shirt_number", shirt_number),
                    ("position", position),
                    ("formation_position", formation_position),
                    ("minutes_played", minutes),
                ):
                    if getattr(row, field) is None and value is not None:
                        setattr(row, field, value)
    return counts


def _shot_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    if "data" in payload:
        return _shot_rows(payload["data"])
    if "data" in payload:
        return _player_rows(payload["data"])
    periods = payload.get("periods")
    rows: list[dict[str, Any]] = []
    if isinstance(periods, dict):
        period_rows = [{"period": name, **value} for name, value in periods.items() if isinstance(value, dict)]
    elif isinstance(periods, list):
        period_rows = [row for row in periods if isinstance(row, dict)]
    else:
        period_rows = []
    for period in period_rows:
        for shot in _as_rows(period, "shots", "events"):
            rows.append({**shot, "period": shot.get("period", period.get("name", period.get("period")))})
    if rows:
        return rows
    return _as_rows(payload, "shots", "events")


def _period(value: Any, minute: int) -> str:
    text_value = (_text(value) or "").lower().replace("_", "")
    if text_value in {"1h", "firsthalf", "first half", "1"}:
        return "1H"
    if text_value in {"2h", "secondhalf", "second half", "2"}:
        return "2H"
    if "extra" in text_value or text_value in {"et", "aet"}:
        return "ET"
    if "penalt" in text_value:
        return "PEN"
    return "1H" if minute <= 45 else ("2H" if minute <= 90 else "ET")


def _shot_minute(row: Mapping[str, Any]) -> int:
    value = _integer(row.get("minute", row.get("time")))
    if value is not None:
        return max(0, value)
    raw = _text(row.get("minute", row.get("time"))) or ""
    leading = re.match(r"\s*(\d+)", raw)
    return int(leading.group(1)) if leading else 0


def _import_shots(
    db: Session,
    fixture: Mapping[str, Any],
    source_key: str,
    match: Match,
    payload: Any,
    external_team_ids: Mapping[str, int],
    resolver: PlayerResolver,
) -> tuple[dict[str, int], dict[int, dict[str, float]]]:
    rows = _shot_rows(payload)
    counts = {"inserted": 0, "updated": 0, "skipped": 0, "unmatched_teams": 0}
    source_ids = [
        f"{source_key}:{row.get('id', row.get('shot_id'))}"
        for row in rows if row.get("id", row.get("shot_id")) is not None
    ]
    existing = {
        event.external_id: event
        for event in db.scalars(
            select(Event)
            .options(selectinload(Event.position), selectinload(Event.shot))
            .where(
                Event.data_source == DataSource.PITCH_API,
                Event.external_id.in_(source_ids),
            )
        ).all()
    } if source_ids else {}
    aggregates: dict[int, dict[str, float]] = {}
    for shot_row in rows:
        raw_id = shot_row.get("id", shot_row.get("shot_id"))
        x_meters = _number(shot_row.get("x", shot_row.get("pitch_x")))
        y_meters = _number(shot_row.get("y", shot_row.get("pitch_y")))
        if (
            raw_id is None
            or x_meters is None
            or y_meters is None
            or not 0 <= x_meters <= PITCH_LENGTH_METERS
            or not 0 <= y_meters <= PITCH_WIDTH_METERS
        ):
            counts["skipped"] += 1
            continue
        x = x_meters * 100.0 / PITCH_LENGTH_METERS
        y = y_meters * 100.0 / PITCH_WIDTH_METERS
        source_team = shot_row.get("team_id", shot_row.get("team"))
        team_id = _resolve_team_id(source_team, fixture, match, external_team_ids)
        if team_id is None:
            counts["unmatched_teams"] += 1
            counts["skipped"] += 1
            continue
        player = resolver.resolve(team_id, _player_name(shot_row))
        minute = _shot_minute(shot_row)
        result = _text(shot_row.get("event_type", shot_row.get("result")))
        result_key = (result or "").lower().replace("_", "").replace(" ", "")
        goal = result_key == "goal" or _boolean(shot_row.get("is_goal")) is True
        on_target = _boolean(shot_row.get("is_on_target", shot_row.get("on_target")))
        if on_target is None:
            on_target = result_key in ON_TARGET_RESULTS or goal
        xg = _number(shot_row.get("expected_goals", shot_row.get("xg")))
        xgot = _number(shot_row.get(
            "expected_goals_on_target",
            shot_row.get("xgot", shot_row.get("expected_goals_on_target_value")),
        ))
        source_event_id = f"{source_key}:{raw_id}"
        event = existing.get(source_event_id)
        inserted = event is None
        if event is None:
            event = Event(
                external_id=source_event_id,
                data_source=DataSource.PITCH_API,
                match_id=match.id,
                team_id=team_id,
                type=EventType.SHOT,
                minute=minute,
            )
            db.add(event)
            existing[source_event_id] = event
        event.match_id = match.id
        event.team_id = team_id
        if player is not None:
            event.player_id = player.id
        event.type = EventType.SHOT
        event.minute = minute
        event.second = _integer(shot_row.get("second"))
        event.period = _period(shot_row.get("period"), minute)
        event.outcome = result
        event.details = {
            **(event.details or {}),
            "pitchapi_shot_id": str(raw_id),
            **({
                "situation": _text(shot_row.get("situation")),
                "shot_type": _text(shot_row.get("shot_type")),
                "minute_added": _integer(shot_row.get("minute_added")),
            }),
        }
        if event.position is None:
            event.position = EventPosition(x=x, y=y)
        else:
            event.position.x, event.position.y = x, y
        shot = event.shot
        if shot is None:
            shot = Shot()
            event.shot = shot
        shot.on_target = bool(on_target)
        shot.is_goal = goal
        body_part = BODY_PARTS.get(
            (_text(shot_row.get("shot_type")) or "").lower().replace(" ", "")
        )
        if body_part is not None:
            shot.body_part = body_part
        situation = _text(shot_row.get("situation"))
        shot_type = _text(shot_row.get("shot_type"))
        if situation is not None:
            shot.situation = situation
        if shot_type is not None:
            shot.shot_type = shot_type
        if xg is not None or shot.xg is None:
            shot.xg = xg
        if xgot is not None or shot.psxg is None:
            shot.psxg = xgot
        counts["inserted" if inserted else "updated"] += 1
        values = aggregates.setdefault(
            team_id,
            {"goals": 0, "shots": 0, "shots_on_target": 0, "xg": 0.0, "xg_available": 0},
        )
        values["shots"] += 1
        values["shots_on_target"] += int(bool(on_target))
        values["goals"] += int(goal)
        if xg is not None:
            values["xg"] += xg
            values["xg_available"] += 1
    return counts, aggregates


def _stat_entries(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, list):
        for entry in value:
            if isinstance(entry, dict):
                if "key" in entry and isinstance(entry.get("stat"), dict):
                    yield {"key": entry["key"], **entry["stat"]}
                elif "key" in entry and "value" in entry:
                    yield entry
                else:
                    yield from _stat_entries(entry)
    elif isinstance(value, dict):
        if "key" in value and isinstance(value.get("stat"), dict):
            yield {"key": value["key"], **value["stat"]}
        elif "key" in value and "value" in value:
            yield value
        else:
            for child in value.values():
                yield from _stat_entries(child)


def _normalized_player_stats(row: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, int | float]]:
    stats_node = row.get("stats", row.get("statistics", []))
    raw: dict[str, Any] = {}
    mapped: dict[str, int | float] = {}
    for stat in _stat_entries(stats_node):
        key = re.sub(r"[^a-z0-9]", "", str(stat.get("key", "")).lower())
        raw_key = _text(stat.get("key"))
        if raw_key:
            raw[raw_key] = {
                "value": stat.get("value"),
                "total": stat.get("total"),
                "type": stat.get("type"),
            }
        field = PLAYER_STAT_FIELDS.get(key)
        value = _number(stat.get("value"))
        if field is None or value is None:
            continue
        mapped[field] = int(round(value)) if field in INTEGER_PLAYER_FIELDS else value
    return raw, mapped


def _player_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    if "data" in payload:
        return _player_rows(payload["data"])
    rows = _as_rows(payload, "players")
    if rows:
        return rows
    for side in ("home", "away"):
        side_data = payload.get(side)
        if isinstance(side_data, dict):
            rows.extend(_as_rows(side_data, "players"))
    return rows


def _merge_provider_stats(row: Any, raw: Mapping[str, Any], mapped: Mapping[str, Any]) -> None:
    supplemental = dict(row.supplemental_stats or {})
    supplemental["pitchapi"] = {"raw": dict(raw), "mapped": dict(mapped)}
    row.supplemental_stats = supplemental
    for field, value in mapped.items():
        if hasattr(row, field) and value is not None and getattr(row, field) in (None, 0):
            setattr(row, field, value)


def _upsert_player_stats(
    db: Session,
    match: Match,
    fixture: Mapping[str, Any],
    payload: Any,
    external_team_ids: Mapping[str, int],
    resolver: PlayerResolver,
    lineup_starters: Mapping[int, bool],
) -> dict[str, int]:
    counts = {"updated": 0, "inserted": 0, "unmatched_players": 0}
    rows = _player_rows(payload)
    existing = {
        row.player_id: row
        for row in db.scalars(
            select(PlayerMatchStatistics).where(PlayerMatchStatistics.match_id == match.id)
        ).all()
    }
    for source in rows:
        name = _player_name(source)
        team_id = _resolve_team_id(
            source.get("team_id", source.get("team", source.get("side"))),
            fixture, match, external_team_ids,
        )
        if not team_id and source.get("side") in {"home", "away"}:
            team_id = match.home_team_id if source["side"] == "home" else match.away_team_id
        player = resolver.resolve(team_id, name) if team_id and name else None
        if player is None or team_id is None:
            counts["unmatched_players"] += 1
            continue
        raw, mapped = _normalized_player_stats(source)
        row = existing.get(player.id)
        inserted = row is None
        if row is None:
            row = PlayerMatchStatistics(
                match_id=match.id,
                player_id=player.id,
                team_id=team_id,
                is_starter=lineup_starters.get(player.id, False),
            )
            db.add(row)
            existing[player.id] = row
        _merge_provider_stats(row, raw, mapped)
        counts["inserted" if inserted else "updated"] += 1
    return counts


def _team_stats_for_side(payload: Any, side: str) -> Any:
    if not isinstance(payload, dict):
        return None
    if "data" in payload:
        return _team_stats_for_side(payload["data"], side)
    periods = payload.get("periods")
    if isinstance(periods, list):
        full_match = next(
            (
                period for period in periods
                if isinstance(period, dict)
                and str(period.get("period", "")).strip().lower() in {"all", "match", "full"}
            ),
            None,
        )
        if full_match is None:
            return None
        raw: dict[str, Any] = {}
        mapped: dict[str, int | float] = {}
        for group in _as_rows(full_match, "groups"):
            for item in _as_rows(group, "items"):
                key = _text(item.get("key"))
                if not key:
                    continue
                value = item.get(side)
                raw[key] = {"value": value, "format_type": item.get("format_type")}
                field = TEAM_STAT_FIELDS.get(re.sub(r"[^a-z0-9]", "", key.lower()))
                number = _team_stat_value(value, item.get("format_type"))
                if field is not None and number is not None:
                    mapped[field] = number
        return {"raw": raw, "mapped": mapped}

    side_data = payload.get(side)
    if isinstance(side_data, dict):
        side_data = side_data.get("stats", side_data.get("statistics", side_data))
    if isinstance(side_data, list):
        raw = {}
        mapped = {}
        for item in side_data:
            if not isinstance(item, dict):
                continue
            key = _text(item.get("key"))
            if not key:
                continue
            value = item.get("value", item.get("display_value"))
            raw[key] = {"value": value, "format_type": item.get("format_type")}
            field = TEAM_STAT_FIELDS.get(re.sub(r"[^a-z0-9]", "", key.lower()))
            number = _team_stat_value(value, item.get("format_type"))
            if field is not None and number is not None:
                mapped[field] = number
        return {"raw": raw, "mapped": mapped}
    return {"raw": side_data, "mapped": {}} if side_data is not None else None


def _team_stat_value(value: Any, format_type: Any) -> float | None:
    if str(format_type or "") == "integerWithPercentage":
        match = re.match(r"\s*(-?\d+(?:\.\d+)?)", str(value or ""))
        return _number(match.group(1)) if match else None
    return _number(value)


def _upsert_team_stats(
    db: Session,
    match: Match,
    stats_payload: Any,
    shot_aggregates: Mapping[int, Mapping[str, float]],
) -> int:
    existing = {
        row.team_id: row
        for row in db.scalars(
            select(TeamMatchStatistics).where(TeamMatchStatistics.match_id == match.id)
        ).all()
    }
    updated = 0
    for side, team_id in (("home", match.home_team_id), ("away", match.away_team_id)):
        raw_stats = _team_stats_for_side(stats_payload, side)
        shot_stats = dict(shot_aggregates.get(team_id, {}))
        if raw_stats is None and not shot_stats:
            continue
        row = existing.get(team_id)
        if row is None:
            row = TeamMatchStatistics(
                match_id=match.id,
                team_id=team_id,
                is_home=side == "home",
            )
            db.add(row)
            existing[team_id] = row
        supplemental = dict(row.supplemental_stats or {})
        provider_values = dict(supplemental.get("pitchapi") or {})
        if raw_stats is not None:
            provider_values["match_stats"] = raw_stats.get("raw", raw_stats)
            provider_values["mapped_match_stats"] = raw_stats.get("mapped", {})
        if shot_stats:
            provider_values["shot_totals"] = {
                key: value for key, value in shot_stats.items()
                if key != "xg_available" and (key != "xg" or shot_stats.get("xg_available"))
            }
        supplemental["pitchapi"] = provider_values
        row.supplemental_stats = supplemental
        mapped = dict(raw_stats.get("mapped", {}) if isinstance(raw_stats, dict) else {})
        for field, value in {
            key: value for key, value in shot_stats.items()
            if key != "xg_available" and (key != "xg" or shot_stats.get("xg_available"))
        }.items():
            mapped.setdefault(field, value)
        for field, value in mapped.items():
            if value is not None and getattr(row, field) in (None, 0):
                setattr(
                    row, field,
                    int(value) if field in TEAM_INTEGER_FIELDS else float(value),
                )
        updated += 1
    return updated


def _state(db: Session, resource: str) -> CollectionState:
    state = db.scalar(
        select(CollectionState).where(
            CollectionState.provider == DataSource.PITCH_API.value,
            CollectionState.resource == resource,
        )
    )
    if state is None:
        state = CollectionState(
            provider=DataSource.PITCH_API.value,
            resource=resource,
            status="partial",
        )
        db.add(state)
    return state


def _sync_fixture(
    db: Session,
    client: PitchAPIClient,
    fixture: Mapping[str, Any],
    source_id: str,
    source_key: str,
    match: Match,
    resolver: PlayerResolver,
) -> dict[str, Any]:
    _upsert_source_match(db, fixture, source_key, match)
    external_team_ids = _source_team_map(fixture, match)
    errors: list[str] = []
    try:
        lineups_payload = client.lineups(source_id)
        lineup_counts = _upsert_lineups(db, match, lineups_payload, resolver)
    except PitchAPIRetryableError:
        raise
    except PitchAPIError as error:
        errors.append(f"lineups: {error}")
        lineup_counts = {"inserted": 0, "unmatched_players": 0, "unconfirmed_sides": 2}

    lineup_starters: dict[int, bool] = {}
    for row in db.scalars(
        select(Lineup).where(Lineup.match_id == match.id, Lineup.is_starter.is_(True))
    ).all():
        lineup_starters[row.player_id] = True

    shots_counts = {"inserted": 0, "updated": 0, "skipped": 0, "unmatched_teams": 0}
    shot_aggregates: dict[int, dict[str, float]] = {}
    player_counts = {"inserted": 0, "updated": 0, "unmatched_players": 0}
    stats_payload = None
    if _is_finished(fixture, match):
        try:
            shots_payload = client.shots(source_id)
            shots_counts, shot_aggregates = _import_shots(
                db, fixture, source_key, match, shots_payload, external_team_ids, resolver,
            )
        except PitchAPIRetryableError:
            raise
        except PitchAPIError as error:
            errors.append(f"shots: {error}")
        try:
            players_payload = client.players(source_id)
            player_counts = _upsert_player_stats(
                db, match, fixture, players_payload, external_team_ids, resolver, lineup_starters,
            )
        except PitchAPIRetryableError:
            raise
        except PitchAPIError as error:
            errors.append(f"players: {error}")
        try:
            stats_payload = client.statistics(source_id)
        except PitchAPIRetryableError:
            raise
        except PitchAPIError as error:
            errors.append(f"stats: {error}")

    team_stats_count = _upsert_team_stats(db, match, stats_payload, shot_aggregates)
    completed = _is_finished(fixture, match)
    status = (
        "success"
        if completed and shots_counts["inserted"] + shots_counts["updated"] > 0 and not errors
        else "failed" if len(errors) == (4 if completed else 1)
        else "partial"
    )
    state = _state(db, source_key)
    state.status = status
    state.summary = {
        "match_id": match.id,
        "finished": completed,
        "lineups": lineup_counts,
        "shots": shots_counts,
        "player_statistics": player_counts,
        "team_statistics": team_stats_count,
        "errors": errors,
    }
    if status == "success":
        state.last_success_at = datetime.utcnow()
    db.flush()
    return {
        "match_id": match.id,
        "status": status,
        "shots": shots_counts["inserted"] + shots_counts["updated"],
        "errors": errors,
    }


def sync_pitchapi(
    db: Session,
    client: PitchAPIClient,
    start_date: date,
    end_date: date,
    league_codes: Iterable[str] = DEFAULT_LEAGUES,
    *,
    limit: int = 100,
    force: bool = False,
) -> dict[str, Any]:
    """Enrich only existing matches in the selected leagues; ambiguous fixtures are skipped."""
    if start_date > end_date:
        raise ValueError("A data inicial deve ser anterior ou igual à data final.")
    if limit < 0:
        raise ValueError("O limite deve ser zero (sem limite) ou um número positivo.")
    codes = tuple(code.strip().upper() for code in league_codes if code.strip())
    if not codes:
        raise ValueError("Informe ao menos um código de liga.")
    local_matches = list(db.scalars(
        select(Match)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .options(selectinload(Match.home_team), selectinload(Match.away_team))
        .where(
            Match.canonical_match_id.is_(None),
            Match.kickoff_time >= datetime.combine(start_date - timedelta(days=1), datetime.min.time()),
            Match.kickoff_time < datetime.combine(end_date + timedelta(days=2), datetime.min.time()),
            Competition.code.in_(codes),
            Match.data_source != DataSource.PITCH_API,
        )
        .order_by(Match.kickoff_time)
    ).all())
    dates = sorted({
        match.kickoff_time.date()
        for match in local_matches
        if start_date <= match.kickoff_time.date() <= end_date
    })
    resolver = PlayerResolver(db)
    summary: dict[str, Any] = {
        "dates_checked": 0,
        "matches_matched": 0,
        "matches_unmatched": 0,
        "matches_ambiguous": 0,
        "matches_skipped": 0,
        "matches_synced": [],
    }
    processed: set[str] = set()
    for fixture_date in dates:
        resource = f"date:{fixture_date.isoformat()}"
        try:
            fixtures = client.fixtures_for_date(fixture_date)
        except PitchAPIError as error:
            state = _state(db, resource)
            state.status = "failed"
            state.summary = {"error": str(error)}
            db.commit()
            raise
        summary["dates_checked"] += 1
        candidates = [
            match for match in local_matches
            if abs((match.kickoff_time.date() - fixture_date).days) <= 1
        ]
        for fixture in fixtures:
            source_id = _match_id(fixture)
            if source_id is None:
                summary["matches_unmatched"] += 1
                continue
            source_key = _source_match_key(fixture, source_id)
            if source_key in processed:
                continue
            match, result = _fixture_match(fixture, candidates)
            if match is None:
                summary[f"matches_{result}"] += 1
                continue
            summary["matches_matched"] += 1
            processed.add(source_key)
            existing_state = db.scalar(
                select(CollectionState).where(
                    CollectionState.provider == DataSource.PITCH_API.value,
                    CollectionState.resource == source_key,
                )
            )
            if existing_state and existing_state.status == "success" and not force:
                summary["matches_skipped"] += 1
                continue
            try:
                result = _sync_fixture(db, client, fixture, source_id, source_key, match, resolver)
            except PitchAPIRetryableError as error:
                state = _state(db, source_key)
                state.status = "failed"
                state.summary = {"match_id": match.id, "error": str(error)}
                db.commit()
                raise
            summary["matches_synced"].append(result)
            db.commit()
            if limit > 0 and len(summary["matches_synced"]) >= limit:
                return summary
    return summary


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use a data no formato AAAA-MM-DD.") from error


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Sincroniza partidas existentes com a PitchAPI.")
    parser.add_argument("--from-date", type=_parse_date)
    parser.add_argument("--to-date", type=_parse_date)
    parser.add_argument("--leagues", default=",".join(DEFAULT_LEAGUES))
    parser.add_argument("--limit", type=int, default=100, help="Máximo de partidas por execução; 0 remove o limite.")
    parser.add_argument("--force", action="store_true", help="Reprocessa partidas já concluídas.")
    args = parser.parse_args(argv)
    today = datetime.now(timezone.utc).date()
    start_date = args.from_date or today - timedelta(days=7)
    end_date = args.to_date or today + timedelta(days=2)
    settings = get_settings()
    client = PitchAPIClient(settings.PITCH_API_KEY)
    try:
        with SessionLocal() as db:
            result = sync_pitchapi(
                db,
                client,
                start_date,
                end_date,
                args.leagues.split(","),
                limit=args.limit,
                force=args.force,
            )
    finally:
        client.close()
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
