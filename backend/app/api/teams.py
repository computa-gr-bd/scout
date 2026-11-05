import re
from datetime import date
from math import isfinite
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, select

from app.db import get_db
from app.db.models import (
    Competition, Lineup, Match, Player, PlayerMatchStatistics, Season,
    TeamMatchStatistics, TeamStatistics,
)
from app.repositories.repositories import (
    TeamRepository, TeamStatisticsRepository, DefensiveWeaknessRepository
)
from app.schemas import TeamOut, TeamDetailedOut, TeamStatisticsOut, DefensiveWeaknessOut
from app.services.studio import _team_ids_like

router = APIRouter(tags=["teams"])
team_repo = TeamRepository()
ts_repo = TeamStatisticsRepository()
dw_repo = DefensiveWeaknessRepository()
TOP5_COMPETITION_CODES = ("PL", "PD", "BL1", "SA", "FL1")
TEAM_DEFENSIVE_FIELDS = ("tackles", "interceptions", "clearances", "shots_blocked", "saves")
GOALKEEPER_FIELDS = ("saves", "goals_conceded", "shots_faced")


def _season_year(name: str, start_date: date | None) -> int | None:
    if start_date is not None:
        return start_date.year
    match = re.match(r"\s*(\d{4})", name)
    return int(match.group(1)) if match else None


def _source_values(
    supplemental: Any,
    fields: tuple[str, ...],
) -> tuple[dict[str, float], dict[str, str]]:
    if not isinstance(supplemental, dict):
        return {}, {}

    values: dict[str, float] = {}
    sources: dict[str, str] = {}
    for source, payload in supplemental.items():
        if source == "preserved" or not isinstance(payload, dict):
            continue
        mapped = payload.get("mapped")
        source_values = mapped if isinstance(mapped, dict) else payload
        for field in fields:
            if field not in source_values or field in values:
                continue
            try:
                value = float(source_values[field])
            except (TypeError, ValueError):
                continue
            if isfinite(value):
                values[field] = value
                sources[field] = source
    return values, sources


def _is_goalkeeper(position: str | None) -> bool:
    if not position:
        return False
    token = re.sub(r"[^a-z]", "", position.lower())
    return token in {"g", "gk", "goalie", "goalkeeper"}


@router.get("/teams", response_model=List[TeamOut])
def list_teams(q: Optional[str] = None, skip: int = 0, limit: int = 50,
               season_id: Optional[int] = None, db: Session = Depends(get_db)):
    if q:
        teams = team_repo.search(db, q, skip=skip, limit=limit, season_id=season_id)
    else:
        if season_id is not None:
            # Só times que têm estatísticas na temporada (times da própria competição)
            # evita que times do StatsBomb (ex: Argentina) apareçam no filtro da competição
            sub = select(TeamStatistics.team_id).where(TeamStatistics.season_id == season_id).distinct()
            teams = list(db.scalars(
                select(team_repo.model).where(team_repo.model.id.in_(sub))
                .order_by(team_repo.model.name).offset(skip).limit(limit)
            ).all())
        else:
            teams = team_repo.list(db, skip=skip, limit=limit, order_by="name")
    # Batch load statistics — one query for the page instead of one per team.
    ids = [t.id for t in teams]
    stats_by_team: Dict[int, list] = {}
    if ids:
        from sqlalchemy import and_
        from sqlalchemy import select as _select
        filters = [TeamStatistics.team_id.in_(ids)]
        if season_id is not None:
            filters.append(TeamStatistics.season_id == season_id)
        for s in db.scalars(_select(TeamStatistics).where(and_(*filters))).all():
            stats_by_team.setdefault(s.team_id, []).append(s)
    from app.services.crests import resolve_crest
    for t in teams:
        if not t.logo_url:
            t.logo_url = resolve_crest(t.name, t.logo_url)
        t.statistics = stats_by_team.get(t.id, [])
    return teams


@router.get("/crests")
def list_crests():
    """Escudos conhecidos por nome de time. O front usa para preencher o logo de qualquer
    time (mesmo quando a API daquela tela não devolveu o escudo)."""
    from app.services.crests import all_crests
    return all_crests()


@router.get("/teams/{team_id}", response_model=TeamDetailedOut)
def get_team(team_id: int, db: Session = Depends(get_db)):
    t = team_repo.get_detailed(db, team_id)
    if not t:
        raise HTTPException(404, "Team not found")
    from app.services.crests import resolve_crest
    if not t.logo_url:
        t.logo_url = resolve_crest(t.name, t.logo_url)
    return t


@router.get("/teams/{team_id}/statistics", response_model=List[TeamStatisticsOut])
def get_team_statistics(team_id: int, scope: str = "overall",
                        season_id: Optional[int] = None, db: Session = Depends(get_db)):
    s = ts_repo.for_team(db, team_id, scope=scope, season_id=season_id)
    if not s:
        return []
    return [s]


@router.get("/teams/{team_id}/weaknesses", response_model=List[DefensiveWeaknessOut])
def get_team_weaknesses(team_id: int, season_id: Optional[int] = None,
                        db: Session = Depends(get_db)):
    return dw_repo.for_team(db, team_id, season_id=season_id)


@router.get("/teams/{team_id}/defensive-stats")
def get_team_defensive_stats(
    team_id: int,
    season_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    team = team_repo.get(db, team_id)
    if team is None:
        raise HTTPException(404, "Team not found")

    team_ids = _team_ids_like(db, team)
    season_rows = db.execute(
        select(Season.id, Competition.code, Season.name, Season.start_date, Season.current)
        .select_from(Match)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(
            Competition.code.in_(TOP5_COMPETITION_CODES),
            Match.canonical_match_id.is_(None),
            or_(
                Match.home_team_id.in_(team_ids),
                Match.away_team_id.in_(team_ids),
            ),
        )
        .distinct()
    ).all()

    selected_seasons = []
    if season_id is not None:
        requested_season = db.get(Season, season_id)
        if requested_season is None:
            raise HTTPException(404, "Season not found")
        requested_code = db.scalar(
            select(Competition.code).where(Competition.id == requested_season.competition_id)
        )
        requested_year = _season_year(requested_season.name, requested_season.start_date)
        selected_seasons = [
            row for row in season_rows
            if row.code == requested_code
            and (
                row.id == season_id
                or (
                    requested_year is not None
                    and _season_year(row.name, row.start_date) == requested_year
                )
            )
        ]
    elif season_rows:
        current_rows = [row for row in season_rows if row.current]
        candidates = current_rows or season_rows
        latest = max(
            candidates,
            key=lambda row: (row.start_date or date.min, row.id),
        )
        latest_year = _season_year(latest.name, latest.start_date)
        selected_seasons = [
            row for row in candidates
            if row.code == latest.code
            and (
                row.id == latest.id
                or (
                    latest_year is not None
                    and _season_year(row.name, row.start_date) == latest_year
                )
            )
        ]

    selected_season_ids = {row.id for row in selected_seasons}
    selected_season = next(
        (row for row in selected_seasons if row.id == season_id),
        min(selected_seasons, key=lambda row: row.id) if selected_seasons else None,
    )
    team_rows = []
    if selected_season_ids:
        team_rows = db.execute(
            select(TeamMatchStatistics, Match.id)
            .join(Match, Match.id == TeamMatchStatistics.match_id)
            .where(
                TeamMatchStatistics.team_id.in_(team_ids),
                Match.season_id.in_(selected_season_ids),
                Match.canonical_match_id.is_(None),
            )
        ).all()
    team_rows.sort(
        key=lambda item: (item[1], item[0].team_id != team_id, item[0].team_id)
    )

    metric_matches: dict[str, set[int]] = {field: set() for field in TEAM_DEFENSIVE_FIELDS}
    metric_totals: dict[str, float] = {field: 0.0 for field in TEAM_DEFENSIVE_FIELDS}
    metric_sources: dict[str, set[str]] = {field: set() for field in TEAM_DEFENSIVE_FIELDS}
    matches_with_stats: set[int] = set()
    for row, match_id in team_rows:
        values, sources = _source_values(row.supplemental_stats, TEAM_DEFENSIVE_FIELDS)
        for field, value in values.items():
            if match_id in metric_matches[field]:
                continue
            metric_totals[field] += value
            metric_matches[field].add(match_id)
            metric_sources[field].add(sources[field])
            matches_with_stats.add(match_id)

    player_rows = []
    if selected_season_ids:
        player_rows = db.execute(
            select(PlayerMatchStatistics, Player, Match.id)
            .join(Player, Player.id == PlayerMatchStatistics.player_id)
            .join(Match, Match.id == PlayerMatchStatistics.match_id)
            .where(
                PlayerMatchStatistics.team_id.in_(team_ids),
                Match.season_id.in_(selected_season_ids),
                Match.canonical_match_id.is_(None),
            )
        ).all()

    lineup_positions: dict[tuple[int, int], list[str | None]] = {}
    player_match_ids = {match_id for _, _, match_id in player_rows}
    if player_match_ids:
        for lineup in db.scalars(
            select(Lineup).where(Lineup.match_id.in_(player_match_ids))
        ).all():
            lineup_positions.setdefault((lineup.match_id, lineup.player_id), []).append(
                lineup.position
            )

    goalkeeper_totals: dict[int, dict[str, Any]] = {}
    for stats, player, match_id in player_rows:
        positions = [
            stats.position,
            player.position,
            *lineup_positions.get((match_id, player.id), []),
        ]
        if not any(_is_goalkeeper(position) for position in positions):
            continue
        values, sources = _source_values(stats.supplemental_stats, GOALKEEPER_FIELDS)
        # Colunas do próprio registro quando o JSON da fonte não traz o campo.
        for field in GOALKEEPER_FIELDS:
            column_value = getattr(stats, field, None)
            if field not in values and column_value is not None:
                values[field] = float(column_value)
                sources[field] = "banco"
        # Reserva que só constou no banco de reservas (tudo zerado): não conta como jogo.
        if not (
            stats.is_starter
            or (stats.minutes_played or 0) > 0
            or any(values.get(field) for field in GOALKEEPER_FIELDS)
        ):
            continue
        # Chutes enfrentados: a fonte costuma mandar 0. Chute no alvo enfrentado = defesas + gols
        # sofridos, então calculamos quando o valor informado está ausente ou zerado.
        if not values.get("shots_faced"):
            saves_value = values.get("saves")
            conceded_value = values.get("goals_conceded")
            if saves_value is not None or conceded_value is not None:
                values["shots_faced"] = (saves_value or 0.0) + (conceded_value or 0.0)
                sources["shots_faced"] = "calculado"
        if not values:
            continue
        aggregate = goalkeeper_totals.setdefault(player.id, {
            "player_id": player.id,
            "name": player.display_name or " ".join(
                part for part in (player.first_name, player.last_name) if part
            ),
            "appearances": set(),
            "totals": {field: 0.0 for field in GOALKEEPER_FIELDS},
            "samples": {field: set() for field in GOALKEEPER_FIELDS},
            "sources": set(),
        })
        aggregate["appearances"].add(match_id)
        aggregate["sources"].update(sources.values())
        for field, value in values.items():
            aggregate["totals"][field] += value
            aggregate["samples"][field].add(match_id)

    goalkeepers = []
    for aggregate in goalkeeper_totals.values():
        appearances = len(aggregate["appearances"])
        goalkeeper = {
            "player_id": aggregate["player_id"],
            "name": aggregate["name"],
            "appearances": appearances,
            "sources": sorted(aggregate["sources"]),
        }
        for field in GOALKEEPER_FIELDS:
            sample_count = len(aggregate["samples"][field])
            goalkeeper[field] = (
                round(aggregate["totals"][field], 2) if sample_count else None
            )
            goalkeeper[f"{field}_per_match"] = (
                round(aggregate["totals"][field] / sample_count, 2)
                if sample_count else None
            )
        goalkeepers.append(goalkeeper)
    goalkeepers.sort(
        key=lambda row: (
            row["saves"] is not None,
            row["saves"] or 0,
            -(row["goals_conceded"] or 0),
        ),
        reverse=True,
    )

    metrics = {}
    for field in TEAM_DEFENSIVE_FIELDS:
        sample_count = len(metric_matches[field])
        metrics[field] = {
            "total": round(metric_totals[field], 2) if sample_count else None,
            "per_match": (
                round(metric_totals[field] / sample_count, 2) if sample_count else None
            ),
            "matches": sample_count,
            "sources": sorted(metric_sources[field]),
        }

    return {
        "team_id": team_id,
        "season_id": selected_season.id if selected_season else season_id,
        "season_name": selected_season.name if selected_season else None,
        "competition_code": selected_season.code if selected_season else None,
        "available": bool(matches_with_stats or goalkeepers),
        "matches_with_stats": len(matches_with_stats),
        "metrics": metrics,
        "goalkeepers": goalkeepers[:5],
    }
