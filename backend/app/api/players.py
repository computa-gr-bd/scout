from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.repositories.repositories import (
    PlayerRepository, PlayerStatisticsRepository, PlayerZoneStatsRepository,
)
from app.schemas import (
    PlayerOut, PlayerDetailedOut, PlayerStatisticsOut, PlayerZoneStatsOut,
    ProbabilityPrediction,
)
from app.services.predictions import predict_for_player, TARGETS
from app.db.models import Match

router = APIRouter(tags=["players"])
player_repo = PlayerRepository()
ps_repo = PlayerStatisticsRepository()
pzs_repo = PlayerZoneStatsRepository()


@router.get("/players", response_model=List[PlayerOut])
def list_players(q: Optional[str] = None, position: Optional[str] = None,
                 team_id: Optional[int] = None, skip: int = 0, limit: int = 50,
                 db: Session = Depends(get_db)):
    if q or position:
        players = player_repo.search(db, q or "", position=position, team_id=team_id,
                                     skip=skip, limit=limit)
    else:
        players = player_repo.list(db, skip=skip, limit=limit, order_by="last_name")
    for p in players:
        p.statistics = [s for s in ps_repo.list(db, filters=[
            ps_repo.model.player_id == p.id
        ])]
    return players


@router.get("/players/{player_id}", response_model=PlayerDetailedOut)
def get_player(player_id: int, db: Session = Depends(get_db)):
    p = player_repo.get_detailed(db, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    return p


@router.get("/players/{player_id}/statistics", response_model=List[PlayerStatisticsOut])
def get_player_statistics(player_id: int, scope: str = "overall",
                          season_id: Optional[int] = None, db: Session = Depends(get_db)):
    s = ps_repo.for_player(db, player_id, scope=scope, season_id=season_id)
    if not s:
        return []
    return [s]


@router.get("/players/{player_id}/zones", response_model=List[PlayerZoneStatsOut])
def get_player_zones(player_id: int, season_id: Optional[int] = None,
                     db: Session = Depends(get_db)):
    return pzs_repo.for_player(db, player_id, season_id=season_id)


def _dummy_match(db: Session, team_id: int) -> Optional[Match]:
    from app.repositories.repositories import MatchRepository
    from sqlalchemy import select, or_, and_
    mr = MatchRepository()
    # find any match team_id has played
    q = select(Match).where(or_(Match.home_team_id == team_id, Match.away_team_id == team_id)).limit(1)
    return db.scalar(q)


@router.get("/players/{player_id}/shot-probability", response_model=ProbabilityPrediction)
def get_shot_probability(player_id: int, opponent_team_id: int,
                         venue: str = Query("home", pattern="^(home|away)$"),
                         db: Session = Depends(get_db)):
    player = player_repo.get(db, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    if opponent_team_id and not player_repo.get(db, opponent_team_id):
        raise HTTPException(404, "Opponent team not found")
    # dummy match object - won't persist, just context
    from datetime import datetime
    from app.db.models import Match as MatchModel
    is_home = venue == "home"
    team_id = _guess_player_team(db, player_id)
    if not team_id:
        team_id = 1
    m = MatchModel(
        id=0,
        season_id=1,
        home_team_id=team_id if is_home else opponent_team_id,
        away_team_id=opponent_team_id if is_home else team_id,
        kickoff_time=datetime.utcnow(),
    )
    p = predict_for_player(db, player, m, "shot",
                           team_id=team_id, opponent_team_id=opponent_team_id,
                           is_home=is_home, include_zone_details=True)
    return ProbabilityPrediction(
        probability=p["probability"],
        baseline_probability=p["baseline_probability"],
        confidence=p["confidence"],
        positive_factors=p["positive_factors"],
        negative_factors=p["negative_factors"],
        model="scoutvision_baseline_shot",
        version="0.1.0",
    )


@router.get("/players/{player_id}/goal-probability", response_model=ProbabilityPrediction)
def get_goal_probability(player_id: int, opponent_team_id: int,
                         venue: str = Query("home", pattern="^(home|away)$"),
                         db: Session = Depends(get_db)):
    player = player_repo.get(db, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    from datetime import datetime
    from app.db.models import Match as MatchModel
    is_home = venue == "home"
    team_id = _guess_player_team(db, player_id) or 1
    m = MatchModel(
        id=0, season_id=1,
        home_team_id=team_id if is_home else opponent_team_id,
        away_team_id=opponent_team_id if is_home else team_id,
        kickoff_time=datetime.utcnow(),
    )
    p = predict_for_player(db, player, m, "goal",
                           team_id=team_id, opponent_team_id=opponent_team_id,
                           is_home=is_home, include_zone_details=True)
    return ProbabilityPrediction(
        probability=p["probability"],
        baseline_probability=p["baseline_probability"],
        confidence=p["confidence"],
        positive_factors=p["positive_factors"],
        negative_factors=p["negative_factors"],
        model="scoutvision_baseline_goal",
        version="0.1.0",
    )


def _guess_player_team(db, player_id: int) -> Optional[int]:
    from app.db.models import PlayerMatchStatistics
    from sqlalchemy import select, desc
    q = (select(PlayerMatchStatistics.team_id)
         .where(PlayerMatchStatistics.player_id == player_id)
         .order_by(desc(PlayerMatchStatistics.created_at)).limit(1))
    return db.scalar(q)
