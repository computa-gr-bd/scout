from typing import List, Optional, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Competition, Season, Standing, Team
from sqlalchemy import select
from app.repositories.repositories import CompetitionRepository, SeasonRepository
from app.schemas import CompetitionOut, SeasonOut

router = APIRouter(tags=["competitions & seasons"])
comp_repo = CompetitionRepository()
season_repo = SeasonRepository()


@router.get("/competitions", response_model=List[CompetitionOut])
def list_competitions(skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    return comp_repo.list(db, skip=skip, limit=limit, order_by=Competition.name)


@router.get("/seasons", response_model=List[SeasonOut])
def list_seasons(competition_id: Optional[int] = Query(None),
                 skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    filters = []
    if competition_id:
        filters.append(Season.competition_id == competition_id)
    return season_repo.list(db, skip=skip, limit=limit, filters=filters, order_by=Season.name)


@router.get("/seasons/{season_id}/standings")
def standings(season_id: int, db: Session = Depends(get_db)):
    season = db.get(Season, season_id)
    if season is None:
        raise HTTPException(404, "Season not found")
    rows = db.execute(select(Standing, Team).join(Team).where(
        Standing.season_id == season_id
    ).order_by(Standing.group_name, Standing.position)).all()
    return [{
        "team_id": team.id, "team_name": team.name,
        "data_source": team.data_source, "updated_at": standing.updated_at,
        **{field: getattr(standing, field) for field in (
            "position", "group_name", "played", "won", "draw", "lost",
            "points", "goals_for", "goals_against", "goal_difference",
        )},
    } for standing, team in rows]
