from typing import List, Optional, Dict, Any
from datetime import datetime

from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select, and_, or_, func

from app.repositories.base import BaseRepository
from app.db.models import (
    Competition, Season, Team, Player, Stadium, Match, Event, Lineup,
    TeamStatistics, PlayerStatistics, PlayerMatchStatistics, TeamMatchStatistics,
    DefensiveWeakness, PlayerZoneStatistics, MatchPrediction, ModelVersion, User
)


class CompetitionRepository(BaseRepository[Competition]):
    def __init__(self): super().__init__(Competition)


class SeasonRepository(BaseRepository[Season]):
    def __init__(self): super().__init__(Season)

    def with_competitions(self, db: Session, skip: int = 0, limit: int = 100):
        q = select(Season).options(selectinload(Season.competition)).offset(skip).limit(limit)
        return list(db.scalars(q).all())


class StadiumRepository(BaseRepository[Stadium]):
    def __init__(self): super().__init__(Stadium)


class TeamRepository(BaseRepository[Team]):
    def __init__(self): super().__init__(Team)

    def get_detailed(self, db: Session, id: int) -> Optional[Team]:
        q = (select(Team)
             .options(selectinload(Team.statistics), selectinload(Team.stadium))
             .where(Team.id == id))
        return db.scalar(q)

    def search(self, db: Session, q_text: str, skip=0, limit=50):
        pattern = f"%{q_text}%"
        return self.list(db, skip=skip, limit=limit, filters=[
            or_(Team.name.ilike(pattern), Team.short_name.ilike(pattern), Team.code.ilike(pattern))
        ], order_by=Team.name)


class PlayerRepository(BaseRepository[Player]):
    def __init__(self): super().__init__(Player)

    def get_detailed(self, db: Session, id: int) -> Optional[Player]:
        q = (select(Player)
             .options(selectinload(Player.statistics), selectinload(Player.zone_stats))
             .where(Player.id == id))
        return db.scalar(q)

    def search(self, db: Session, q_text: str, position: Optional[str] = None, team_id: Optional[int] = None,
               skip=0, limit=50) -> List[Player]:
        pattern = f"%{q_text}%"
        filters = [
            or_(Player.display_name.ilike(pattern), Player.last_name.ilike(pattern), Player.first_name.ilike(pattern))
        ]
        if position:
            filters.append(Player.position.ilike(f"%{position}%"))
        if team_id:
            filters.append(Player.team_id == team_id)
        q = select(Player).where(and_(*filters)).order_by(Player.last_name).offset(skip).limit(limit)
        return list(db.scalars(q).all())

    def by_team_in_match(self, db: Session, match_id: int, team_id: int) -> List[Player]:
        q = (select(Player)
             .join(Lineup, Lineup.player_id == Player.id)
             .where(and_(Lineup.match_id == match_id, Lineup.team_id == team_id))
             .order_by(Lineup.is_starter.desc(), Lineup.formation_position))
        return list(db.scalars(q).all())


class MatchRepository(BaseRepository[Match]):
    def __init__(self): super().__init__(Match)

    def upcoming(self, db: Session, skip=0, limit=20, competition_id: Optional[int] = None,
                 team_id: Optional[int] = None):
        now = datetime.utcnow()
        q = select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team),
                                  selectinload(Match.season), selectinload(Match.stadium))
        q = q.where(Match.kickoff_time >= now).order_by(Match.kickoff_time)
        if competition_id:
            q = q.join(Season).where(Season.competition_id == competition_id)
        if team_id:
            q = q.where(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
        q = q.offset(skip).limit(limit)
        return list(db.scalars(q).all())

    def recent(self, db: Session, skip=0, limit=20, team_id: Optional[int] = None):
        now = datetime.utcnow()
        q = select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team),
                                  selectinload(Match.season))
        q = q.where(Match.kickoff_time < now, Match.status != "scheduled").order_by(Match.kickoff_time.desc())
        if team_id:
            q = q.where(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
        q = q.offset(skip).limit(limit)
        return list(db.scalars(q).all())

    def get_detailed(self, db: Session, id: int) -> Optional[Match]:
        q = (select(Match)
             .options(selectinload(Match.home_team), selectinload(Match.away_team),
                      selectinload(Match.season).selectinload(Season.competition),
                      selectinload(Match.stadium), selectinload(Match.lineups),
                      selectinload(Match.events).selectinload(Event.position),
                      selectinload(Match.team_match_stats))
             .where(Match.id == id))
        return db.scalar(q)

    def head_to_head(self, db: Session, team_a: int, team_b: int, limit: int = 10) -> List[Match]:
        q = (select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team))
             .where(or_(and_(Match.home_team_id == team_a, Match.away_team_id == team_b),
                        and_(Match.home_team_id == team_b, Match.away_team_id == team_a)))
             .order_by(Match.kickoff_time.desc()).limit(limit))
        return list(db.scalars(q).all())


class EventRepository(BaseRepository[Event]):
    def __init__(self): super().__init__(Event)

    def by_match(self, db: Session, match_id: int) -> List[Event]:
        q = (select(Event).options(selectinload(Event.position))
             .where(Event.match_id == match_id).order_by(Event.minute, Event.second))
        return list(db.scalars(q).all())


class TeamStatisticsRepository(BaseRepository[TeamStatistics]):
    def __init__(self): super().__init__(TeamStatistics)

    def for_team(self, db: Session, team_id: int, scope: str = "overall", season_id: Optional[int] = None):
        filters = [TeamStatistics.team_id == team_id, TeamStatistics.scope == scope]
        if season_id is not None:
            filters.append(TeamStatistics.season_id == season_id)
        else:
            filters.append(TeamStatistics.season_id.is_(None))
        return db.scalar(select(TeamStatistics).where(and_(*filters)))


class PlayerStatisticsRepository(BaseRepository[PlayerStatistics]):
    def __init__(self): super().__init__(PlayerStatistics)

    def for_player(self, db: Session, player_id: int, scope: str = "overall", season_id: Optional[int] = None):
        filters = [PlayerStatistics.player_id == player_id, PlayerStatistics.scope == scope]
        if season_id is not None:
            filters.append(PlayerStatistics.season_id == season_id)
        else:
            filters.append(PlayerStatistics.season_id.is_(None))
        return db.scalar(select(PlayerStatistics).where(and_(*filters)))


class PlayerZoneStatsRepository(BaseRepository[PlayerZoneStatistics]):
    def __init__(self): super().__init__(PlayerZoneStatistics)

    def for_player(self, db: Session, player_id: int, season_id: Optional[int] = None):
        filters = [PlayerZoneStatistics.player_id == player_id]
        if season_id is not None:
            filters.append(PlayerZoneStatistics.season_id == season_id)
        else:
            filters.append(PlayerZoneStatistics.season_id.is_(None))
        q = select(PlayerZoneStatistics).where(and_(*filters)).order_by(PlayerZoneStatistics.zone_frequency_pct.desc())
        return list(db.scalars(q).all())


class DefensiveWeaknessRepository(BaseRepository[DefensiveWeakness]):
    def __init__(self): super().__init__(DefensiveWeakness)

    def for_team(self, db: Session, team_id: int, season_id: Optional[int] = None):
        filters = [DefensiveWeakness.team_id == team_id]
        if season_id is not None:
            filters.append(DefensiveWeakness.season_id == season_id)
        else:
            filters.append(DefensiveWeakness.season_id.is_(None))
        q = select(DefensiveWeakness).where(and_(*filters)).order_by(DefensiveWeakness.weakness_score.desc())
        return list(db.scalars(q).all())


class MatchPredictionRepository(BaseRepository[MatchPrediction]):
    def __init__(self): super().__init__(MatchPrediction)

    def for_match(self, db: Session, match_id: int, target: Optional[str] = None):
        filters = [MatchPrediction.match_id == match_id]
        if target:
            filters.append(MatchPrediction.target == target)
        q = select(MatchPrediction).where(and_(*filters)).order_by(MatchPrediction.probability.desc())
        return list(db.scalars(q).all())


class ModelVersionRepository(BaseRepository[ModelVersion]):
    def __init__(self): super().__init__(ModelVersion)

    def active_for_target(self, db: Session, target: str) -> Optional[ModelVersion]:
        return db.scalar(select(ModelVersion).where(
            and_(ModelVersion.target == target, ModelVersion.is_active == True)
        ))


class UserRepository(BaseRepository[User]):
    def __init__(self): super().__init__(User)

    def by_email(self, db: Session, email: str) -> Optional[User]:
        return db.scalar(select(User).where(func.lower(User.email) == email.lower()))
