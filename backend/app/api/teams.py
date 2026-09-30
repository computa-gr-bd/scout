from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
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
        teams = team_repo.list(db, skip=skip, limit=limit, order_by="name")
    # attach overall statistics
    for t in teams:
        t.statistics = [s for s in ts_repo.list(db, filters=[
            ts_repo.model.team_id == t.id
        ])]
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
