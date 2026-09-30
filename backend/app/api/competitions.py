from typing import List, Optional, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import Competition, Season
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
