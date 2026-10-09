from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db import get_db
from app.db.models import TeamStatistics
from app.repositories.repositories import (
    TeamRepository, TeamStatisticsRepository, DefensiveWeaknessRepository
)
from app.schemas import TeamOut, TeamDetailedOut, TeamStatisticsOut, DefensiveWeaknessOut

router = APIRouter(tags=["teams"])
team_repo = TeamRepository()
ts_repo = TeamStatisticsRepository()
dw_repo = DefensiveWeaknessRepository()


@router.get("/teams", response_model=List[TeamOut])
def list_teams(q: Optional[str] = None, skip: int = 0, limit: int = 50,
               season_id: Optional[int] = None, db: Session = Depends(get_db)):
    if q:
        teams = team_repo.search(db, q, skip=skip, limit=limit)
    else:
        if season_id is not None:
            # Só times que têm estatísticas na temporada (times da própria competição)
            # evita que times do StatsBomb (ex: Argentina) apareçam no filtro BSA
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
    for t in teams:
        t.statistics = stats_by_team.get(t.id, [])
    return teams


@router.get("/teams/{team_id}", response_model=TeamDetailedOut)
def get_team(team_id: int, db: Session = Depends(get_db)):
    t = team_repo.get_detailed(db, team_id)
    if not t:
        raise HTTPException(404, "Team not found")
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
