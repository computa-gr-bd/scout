from datetime import datetime
from enum import Enum as PyEnum
import uuid

from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date, Time, Text,
    ForeignKey, UniqueConstraint, Index, Enum, JSON, UUID, BigInteger
)
from sqlalchemy.orm import relationship

from app.db import Base


def _uuid():
    return str(uuid.uuid4())


class DataSource(str, PyEnum):
    DEMO = "demo"
    API_FOOTBALL = "api_football"
    FOOTBALL_DATA = "football_data"
    STATSBOMB = "statsbomb"
    MANUAL = "manual"


class UserRole(str, PyEnum):
    USER = "user"
    ADMIN = "admin"


class EventType(str, PyEnum):
    SHOT = "shot"
    PASS = "pass"
    GOAL = "goal"
    CORNER = "corner"
    FOUL = "foul"
    CARD = "card"
    SUBSTITUTION = "substitution"
    DRIBBLE = "dribble"
    DUEL = "duel"
    INTERCEPTION = "interception"
    TACKLE = "tackle"
    SAVE = "save"
    OTHER = "other"


class PitchZone(str, PyEnum):
    OWN_BOX = "own_box"
    OWN_LEFT_CHANNEL = "own_left_channel"
    OWN_RIGHT_CHANNEL = "own_right_channel"
    OWN_CENTRAL_MIDFIELD = "own_central_midfield"
    OWN_LEFT_FLANK = "own_left_flank"
    OWN_RIGHT_FLANK = "own_right_flank"
    NEUTRAL_MIDFIELD = "neutral_midfield"
    NEUTRAL_LEFT_FLANK = "neutral_left_flank"
    NEUTRAL_RIGHT_FLANK = "neutral_right_flank"
    OPP_LEFT_FLANK = "opp_left_flank"
    OPP_RIGHT_FLANK = "opp_right_flank"
    OPP_LEFT_CHANNEL = "opp_left_channel"
    OPP_RIGHT_CHANNEL = "opp_right_channel"
    OPP_CENTRAL_MIDFIELD = "opp_central_midfield"
    OUTSIDE_BOX_LEFT = "outside_box_left"
    OUTSIDE_BOX_RIGHT = "outside_box_right"
    OUTSIDE_BOX_CENTRAL = "outside_box_central"
    CENTRAL_BOX = "central_box"


ZONE_ORDER = list(PitchZone)

def stored_enum(enum_class):
    # Alembic stores enum values (e.g. "demo"), not Python member names ("DEMO").
    return Enum(enum_class, values_callable=lambda cls: [item.value for item in cls])


class TimestampMixin:
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255))
    hashed_password = Column(String(255), nullable=False)
    role = Column(stored_enum(UserRole), default=UserRole.USER, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)


class DataSourceRecord(Base, TimestampMixin):
    __tablename__ = "data_source"
    id = Column(Integer, primary_key=True)
    name = Column(stored_enum(DataSource), unique=True, nullable=False)
    description = Column(Text)
    last_import_at = Column(DateTime)


class Competition(Base, TimestampMixin):
    __tablename__ = "competition"
    __table_args__ = (UniqueConstraint("data_source", "external_id", name="uq_competition_source_external"),)
    id = Column(Integer, primary_key=True)
    external_id = Column(String(128), index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(32))
    country = Column(String(128))
    type = Column(String(32), default="league")
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)
    seasons = relationship("Season", back_populates="competition", cascade="all, delete-orphan")


class Season(Base, TimestampMixin):
    __tablename__ = "season"
    __table_args__ = (UniqueConstraint("competition_id", "name", name="uq_season_competition_name"),)
    id = Column(Integer, primary_key=True)
    competition_id = Column(Integer, ForeignKey("competition.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(64), nullable=False)
    start_date = Column(Date)
    end_date = Column(Date)
    current = Column(Boolean, default=False)
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)
    competition = relationship("Competition", back_populates="seasons")
    matches = relationship("Match", back_populates="season", cascade="all, delete-orphan")


class Stadium(Base, TimestampMixin):
    __tablename__ = "stadium"
    __table_args__ = (UniqueConstraint("data_source", "external_id", name="uq_stadium_source_external"),)
    id = Column(Integer, primary_key=True)
    external_id = Column(String(128), index=True)
    name = Column(String(255), nullable=False)
    city = Column(String(128))
    country = Column(String(128))
    capacity = Column(Integer)
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)


class Team(Base, TimestampMixin):
    __tablename__ = "team"
    __table_args__ = (UniqueConstraint("data_source", "external_id", name="uq_team_source_external"),)
    id = Column(Integer, primary_key=True)
    external_id = Column(String(128), index=True)
    name = Column(String(255), nullable=False)
    short_name = Column(String(64))
    code = Column(String(16))
    country = Column(String(128))
    founded = Column(Integer)
    stadium_id = Column(Integer, ForeignKey("stadium.id"))
    logo_url = Column(String(512))
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)
    stadium = relationship("Stadium")
    home_matches = relationship("Match", foreign_keys="Match.home_team_id", back_populates="home_team")
    away_matches = relationship("Match", foreign_keys="Match.away_team_id", back_populates="away_team")
    statistics = relationship("TeamStatistics", back_populates="team", cascade="all, delete-orphan")
    weaknesses = relationship("DefensiveWeakness", back_populates="team", cascade="all, delete-orphan")


class Player(Base, TimestampMixin):
    __tablename__ = "player"
    __table_args__ = (UniqueConstraint("data_source", "external_id", name="uq_player_source_external"),)
    id = Column(Integer, primary_key=True)
    external_id = Column(String(128), index=True)
    first_name = Column(String(128))
    last_name = Column(String(128), nullable=False)
    display_name = Column(String(255))
    date_of_birth = Column(Date)
    country = Column(String(128))
    nationality = Column(String(128))
    height_cm = Column(Float)
    weight_kg = Column(Float)
    preferred_foot = Column(String(8))
    position = Column(String(32))
    # Clube atual — vem do squad da football-data; None quando o provedor
    # não informa (ex.: StatsBomb sem lineup importado).
    team_id = Column(Integer, ForeignKey("team.id", ondelete="SET NULL"), index=True)
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)
    team = relationship("Team")
    statistics = relationship("PlayerStatistics", back_populates="player", cascade="all, delete-orphan")
    zone_stats = relationship("PlayerZoneStatistics", back_populates="player", cascade="all, delete-orphan")


class Match(Base, TimestampMixin):
    __tablename__ = "match"
    __table_args__ = (
        Index("ix_match_date_kickoff", "kickoff_time"),
        UniqueConstraint("data_source", "external_id", name="uq_match_source_external"),
    )
    id = Column(Integer, primary_key=True)
    external_id = Column(String(128), index=True)
    season_id = Column(Integer, ForeignKey("season.id", ondelete="CASCADE"), nullable=False, index=True)
    home_team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    away_team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    stadium_id = Column(Integer, ForeignKey("stadium.id"))
    kickoff_time = Column(DateTime, nullable=False)
    round_name = Column(String(64))
    matchday = Column(Integer)
    status = Column(String(32), default="scheduled")
    home_score = Column(Integer)
    away_score = Column(Integer)
    home_ht_score = Column(Integer)
    away_ht_score = Column(Integer)
    referee = Column(String(255))
    attendance = Column(Integer)
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)
    season = relationship("Season", back_populates="matches")
    home_team = relationship("Team", foreign_keys=[home_team_id], back_populates="home_matches")
    away_team = relationship("Team", foreign_keys=[away_team_id], back_populates="away_matches")
    stadium = relationship("Stadium")
    lineups = relationship("Lineup", back_populates="match", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="match", cascade="all, delete-orphan")
    predictions = relationship("MatchPrediction", back_populates="match", cascade="all, delete-orphan")
    team_match_stats = relationship("TeamMatchStatistics", back_populates="match", cascade="all, delete-orphan")


class Lineup(Base, TimestampMixin):
    __tablename__ = "lineup"
    __table_args__ = (UniqueConstraint("match_id", "team_id", "player_id", name="uq_lineup_match_team_player"),)
    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("match.id", ondelete="CASCADE"), nullable=False, index=True)
    team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    player_id = Column(Integer, ForeignKey("player.id"), nullable=False, index=True)
    is_starter = Column(Boolean, default=True, nullable=False)
    shirt_number = Column(Integer)
    position = Column(String(32))
    formation_position = Column(String(16))
    minutes_played = Column(Integer)
    match = relationship("Match", back_populates="lineups")
    team = relationship("Team")
    player = relationship("Player")


class Event(Base, TimestampMixin):
    __tablename__ = "event"
    __table_args__ = (
        Index("ix_event_match_type", "match_id", "type"),
        UniqueConstraint("data_source", "external_id", name="uq_event_source_external"),
    )
    id = Column(Integer, primary_key=True)
    external_id = Column(String(128), index=True)
    match_id = Column(Integer, ForeignKey("match.id", ondelete="CASCADE"), nullable=False, index=True)
    team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    player_id = Column(Integer, ForeignKey("player.id"), index=True)
    secondary_player_id = Column(Integer, ForeignKey("player.id"))
    type = Column(stored_enum(EventType), nullable=False)
    minute = Column(Integer, nullable=False)
    second = Column(Integer)
    period = Column(String(32))
    outcome = Column(String(32))
    details = Column(JSON)
    data_source = Column(stored_enum(DataSource), default=DataSource.DEMO, nullable=False)
    match = relationship("Match", back_populates="events")
    team = relationship("Team")
    player = relationship("Player", foreign_keys=[player_id])
    secondary_player = relationship("Player", foreign_keys=[secondary_player_id])
    position = relationship("EventPosition", back_populates="event", uselist=False, cascade="all, delete-orphan")
    shot = relationship("Shot", back_populates="event", uselist=False, cascade="all, delete-orphan")
    pass_ = relationship("Pass", back_populates="event", uselist=False, cascade="all, delete-orphan")
    goal = relationship("Goal", back_populates="event", uselist=False, cascade="all, delete-orphan")
    corner = relationship("Corner", back_populates="event", uselist=False, cascade="all, delete-orphan")


class EventPosition(Base, TimestampMixin):
    __tablename__ = "event_position"
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    end_x = Column(Float)
    end_y = Column(Float)
    zone = Column(stored_enum(PitchZone), index=True)
    event = relationship("Event", back_populates="position")


class Shot(Base, TimestampMixin):
    __tablename__ = "shot"
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    on_target = Column(Boolean, default=False)
    is_goal = Column(Boolean, default=False)
    body_part = Column(String(32))
    situation = Column(String(64))
    shot_type = Column(String(32))
    xg = Column(Float)
    psxg = Column(Float)
    event = relationship("Event", back_populates="shot")


class Pass(Base, TimestampMixin):
    __tablename__ = "pass"
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    length = Column(Float)
    angle = Column(Float)
    is_key_pass = Column(Boolean, default=False)
    is_assist = Column(Boolean, default=False)
    is_through_ball = Column(Boolean, default=False)
    height = Column(String(32))
    pass_recipient_id = Column(Integer, ForeignKey("player.id"))
    xa = Column(Float)
    event = relationship("Event", back_populates="pass_")
    recipient = relationship("Player", foreign_keys=[pass_recipient_id])


class Goal(Base, TimestampMixin):
    __tablename__ = "goal"
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    scorer_player_id = Column(Integer, ForeignKey("player.id"), nullable=False)
    assist_player_id = Column(Integer, ForeignKey("player.id"))
    is_penalty = Column(Boolean, default=False)
    is_own_goal = Column(Boolean, default=False)
    body_part = Column(String(32))
    assist_type = Column(String(64))
    event = relationship("Event", back_populates="goal")
    scorer = relationship("Player", foreign_keys=[scorer_player_id])
    assist = relationship("Player", foreign_keys=[assist_player_id])


class Corner(Base, TimestampMixin):
    __tablename__ = "corner"
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("event.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    side = Column(String(16))
    outcome = Column(String(32))
    assist_player_id = Column(Integer, ForeignKey("player.id"))
    event = relationship("Event", back_populates="corner")
    assist = relationship("Player", foreign_keys=[assist_player_id])


class TeamStatistics(Base, TimestampMixin):
    __tablename__ = "team_statistics"
    __table_args__ = (UniqueConstraint("team_id", "season_id", "scope", name="uq_team_stat_season_scope"),)
    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("team.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id = Column(Integer, ForeignKey("season.id", ondelete="CASCADE"), index=True)
    scope = Column(String(32), default="overall")
    matches_played = Column(Integer, default=0)
    wins = Column(Integer, default=0)
    draws = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    goals_for = Column(Float, default=0)
    goals_against = Column(Float, default=0)
    shots = Column(Float, default=0)
    shots_on_target = Column(Float, default=0)
    xg_total = Column(Float, default=0)
    xga_total = Column(Float, default=0)
    corners_total = Column(Float, default=0)
    shots_per_90 = Column(Float, default=0)
    shots_on_target_per_90 = Column(Float, default=0)
    xg_per_90 = Column(Float, default=0)
    xga_per_90 = Column(Float, default=0)
    goals_conceded_per_90 = Column(Float, default=0)
    shots_conceded_per_90 = Column(Float, default=0)
    corners_per_90 = Column(Float, default=0)
    points_per_game = Column(Float, default=0)
    recent_form = Column(JSON)
    team = relationship("Team", back_populates="statistics")


class PlayerStatistics(Base, TimestampMixin):
    __tablename__ = "player_statistics"
    __table_args__ = (UniqueConstraint("player_id", "season_id", "scope", name="uq_player_stat_season_scope"),)
    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("player.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id = Column(Integer, ForeignKey("season.id", ondelete="CASCADE"), index=True)
    scope = Column(String(32), default="overall")
    matches_played = Column(Integer, default=0)
    minutes_played = Column(Integer, default=0)
    starts = Column(Integer, default=0)
    goals = Column(Integer, default=0)
    assists = Column(Integer, default=0)
    shots = Column(Integer, default=0)
    shots_on_target = Column(Integer, default=0)
    xg_total = Column(Float, default=0)
    xa_total = Column(Float, default=0)
    passes = Column(Integer, default=0)
    passes_completed = Column(Integer, default=0)
    key_passes = Column(Integer, default=0)
    touches_in_box = Column(Integer, default=0)
    dribbles = Column(Integer, default=0)
    dribbles_success = Column(Integer, default=0)
    fouls_suffered = Column(Integer, default=0)
    fouls_committed = Column(Integer, default=0)
    tackles = Column(Integer, default=0)
    interceptions = Column(Integer, default=0)
    clearances = Column(Integer, default=0)
    duels = Column(Integer, default=0)
    duels_won = Column(Integer, default=0)
    crosses = Column(Integer, default=0)
    crosses_completed = Column(Integer, default=0)
    corners_taken = Column(Integer, default=0)
    shots_per_90 = Column(Float, default=0)
    shots_on_target_per_90 = Column(Float, default=0)
    xg_per_90 = Column(Float, default=0)
    xa_per_90 = Column(Float, default=0)
    key_passes_per_90 = Column(Float, default=0)
    touches_in_box_per_90 = Column(Float, default=0)
    corners_per_90 = Column(Float, default=0)
    goals_per_90 = Column(Float, default=0)
    assists_per_90 = Column(Float, default=0)
    tackle_pct = Column(Float, default=0)
    dribble_success_pct = Column(Float, default=0)
    pass_accuracy_pct = Column(Float, default=0)
    recent_form = Column(JSON)
    pace = Column(Float)
    dribbling = Column(Float)
    defensive_workrate = Column(Float)
    attacking_workrate = Column(Float)
    player = relationship("Player", back_populates="statistics")


class PlayerMatchStatistics(Base, TimestampMixin):
    __tablename__ = "player_match_statistics"
    __table_args__ = (UniqueConstraint("player_id", "match_id", name="uq_pms_player_match"),)
    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("player.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id = Column(Integer, ForeignKey("match.id", ondelete="CASCADE"), nullable=False, index=True)
    team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    minutes_played = Column(Integer, default=0)
    is_starter = Column(Boolean, default=False)
    position = Column(String(32))
    goals = Column(Integer, default=0)
    assists = Column(Integer, default=0)
    shots = Column(Integer, default=0)
    shots_on_target = Column(Integer, default=0)
    xg = Column(Float, default=0)
    passes = Column(Integer, default=0)
    passes_completed = Column(Integer, default=0)
    key_passes = Column(Integer, default=0)
    xa = Column(Float, default=0)
    touches_in_box = Column(Integer, default=0)
    tackles = Column(Integer, default=0)
    interceptions = Column(Integer, default=0)
    duels = Column(Integer, default=0)
    duels_won = Column(Integer, default=0)
    fouls_suffered = Column(Integer, default=0)
    fouls_committed = Column(Integer, default=0)
    rating = Column(Float)
    player = relationship("Player")
    match = relationship("Match")
    team = relationship("Team")


class TeamMatchStatistics(Base, TimestampMixin):
    __tablename__ = "team_match_statistics"
    __table_args__ = (UniqueConstraint("team_id", "match_id", name="uq_tms_team_match"),)
    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("team.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id = Column(Integer, ForeignKey("match.id", ondelete="CASCADE"), nullable=False, index=True)
    is_home = Column(Boolean, default=False)
    goals = Column(Integer, default=0)
    goals_conceded = Column(Integer, default=0)
    shots = Column(Integer, default=0)
    shots_on_target = Column(Integer, default=0)
    xg = Column(Float, default=0)
    xga = Column(Float, default=0)
    possession_pct = Column(Float)
    passes = Column(Integer, default=0)
    passes_completed = Column(Integer, default=0)
    corners = Column(Integer, default=0)
    fouls = Column(Integer, default=0)
    tackles = Column(Integer, default=0)
    interceptions = Column(Integer, default=0)
    saves = Column(Integer, default=0)
    team = relationship("Team")
    match = relationship("Match", back_populates="team_match_stats")


class DefensiveWeakness(Base, TimestampMixin):
    __tablename__ = "defensive_weakness"
    __table_args__ = (UniqueConstraint("team_id", "season_id", "zone", name="uq_dw_team_season_zone"),)
    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("team.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id = Column(Integer, ForeignKey("season.id", ondelete="CASCADE"), index=True)
    zone = Column(stored_enum(PitchZone), nullable=False, index=True)
    weakness_score = Column(Float, default=0, nullable=False)
    shots_conceded_per_90 = Column(Float, default=0)
    xga_per_90 = Column(Float, default=0)
    goals_conceded_per_90 = Column(Float, default=0)
    sample_size = Column(Integer, default=0)
    notes = Column(JSON)
    team = relationship("Team", back_populates="weaknesses")


class PlayerZoneStatistics(Base, TimestampMixin):
    __tablename__ = "player_zone_statistics"
    __table_args__ = (UniqueConstraint("player_id", "season_id", "zone", name="uq_pzs_player_season_zone"),)
    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("player.id", ondelete="CASCADE"), nullable=False, index=True)
    season_id = Column(Integer, ForeignKey("season.id", ondelete="CASCADE"), index=True)
    zone = Column(stored_enum(PitchZone), nullable=False, index=True)
    sample_size = Column(Integer, default=0)
    touches = Column(Integer, default=0)
    shots = Column(Integer, default=0)
    shots_on_target = Column(Integer, default=0)
    goals = Column(Integer, default=0)
    xg = Column(Float, default=0)
    passes = Column(Integer, default=0)
    key_passes = Column(Integer, default=0)
    xa = Column(Float, default=0)
    touches_per_90 = Column(Float, default=0)
    shots_per_90 = Column(Float, default=0)
    xg_per_90 = Column(Float, default=0)
    zone_frequency_pct = Column(Float, default=0)
    offensive_strength = Column(Float, default=0)
    player = relationship("Player", back_populates="zone_stats")


class ModelVersion(Base, TimestampMixin):
    __tablename__ = "model_version"
    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False)
    version = Column(String(64), nullable=False)
    target = Column(String(64), nullable=False)
    algorithm = Column(String(64), nullable=False)
    file_path = Column(String(512))
    train_season_range = Column(String(128))
    val_season_range = Column(String(128))
    test_season_range = Column(String(128))
    accuracy = Column(Float)
    precision = Column(Float)
    recall = Column(Float)
    f1 = Column(Float)
    roc_auc = Column(Float)
    log_loss = Column(Float)
    brier_score = Column(Float)
    calibration_summary = Column(JSON)
    feature_names = Column(JSON)
    is_active = Column(Boolean, default=False)
    UniqueConstraint("name", "version", name="uq_mv_name_version")


class MatchPrediction(Base, TimestampMixin):
    __tablename__ = "match_prediction"
    __table_args__ = (Index("ix_prediction_match_player", "match_id", "player_id"),)
    id = Column(Integer, primary_key=True)
    match_id = Column(Integer, ForeignKey("match.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(Integer, ForeignKey("player.id"), nullable=False, index=True)
    team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    opponent_team_id = Column(Integer, ForeignKey("team.id"), nullable=False, index=True)
    model_version_id = Column(Integer, ForeignKey("model_version.id"))
    target = Column(String(64), nullable=False)
    probability = Column(Float, nullable=False)
    baseline_probability = Column(Float)
    venue = Column(String(8))
    factors = Column(JSON)
    zones = Column(JSON)
    confidence = Column(String(16), default="medium")
    match = relationship("Match", back_populates="predictions")
    player = relationship("Player")
    team = relationship("Team", foreign_keys=[team_id])
    opponent = relationship("Team", foreign_keys=[opponent_team_id])
    model_version = relationship("ModelVersion")


class PredictionFactor(Base, TimestampMixin):
    __tablename__ = "prediction_factor"
    id = Column(Integer, primary_key=True)
    prediction_id = Column(Integer, ForeignKey("match_prediction.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    value = Column(Float)
    weight = Column(Float, nullable=False)
    direction = Column(String(16), nullable=False)
    description = Column(String(512))


class CollectionState(Base, TimestampMixin):
    """One bounded checkpoint per provider/resource, including the last failure."""
    __tablename__ = "collection_state"
    __table_args__ = (UniqueConstraint("provider", "resource", name="uq_collection_resource"),)
    id = Column(Integer, primary_key=True)
    provider = Column(String(32), nullable=False)
    resource = Column(String(128), nullable=False)
    last_success_at = Column(DateTime)
    status = Column(String(32), nullable=False)
    summary = Column(JSON)


class Standing(Base, TimestampMixin):
    """Basic standings, kept separate from advanced analytics that need event data."""
    __tablename__ = "standing"
    __table_args__ = (UniqueConstraint("season_id", "team_id", "group_name", name="uq_standing_team"),)
    id = Column(Integer, primary_key=True)
    season_id = Column(Integer, ForeignKey("season.id", ondelete="CASCADE"), nullable=False)
    team_id = Column(Integer, ForeignKey("team.id", ondelete="CASCADE"), nullable=False)
    group_name = Column(String(64), nullable=False, default="")
    position = Column(Integer)
    played = Column(Integer)
    won = Column(Integer)
    draw = Column(Integer)
    lost = Column(Integer)
    points = Column(Integer)
    goals_for = Column(Integer)
    goals_against = Column(Integer)
    goal_difference = Column(Integer)
