from datetime import datetime, date
from typing import List, Optional, Dict, Any, Literal
from enum import Enum

from pydantic import BaseModel, Field, ConfigDict

from app.db.models import UserRole, DataSource, EventType, PitchZone


class PaginationParams(BaseModel):
    skip: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=500)


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[Any]


# ========== Shared ==========
class SuccessResponse(BaseModel):
    success: bool = True
    message: Optional[str] = None


class ProbabilityPrediction(BaseModel):
    probability: float
    baseline_probability: Optional[float] = None
    confidence: str = "medium"
    positive_factors: List[Dict[str, Any]] = []
    negative_factors: List[Dict[str, Any]] = []
    model: Optional[str] = None
    version: Optional[str] = None


class MatchupScore(BaseModel):
    attacker_id: int
    defender_id: int
    score: float
    strengths: List[str]
    weaknesses: List[str]
    evidence: List[Dict[str, Any]]


class ZoneOpportunity(BaseModel):
    zone: PitchZone
    opportunity_score: float
    offensive_strength: float
    defensive_weakness: float
    player_frequency: float


# ========== Auth ==========
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: int


class TokenPayload(BaseModel):
    sub: Optional[int] = None
    role: Optional[UserRole] = None
    exp: Optional[datetime] = None


class UserLogin(BaseModel):
    email: str
    password: str


class UserBase(BaseModel):
    email: str
    full_name: Optional[str] = None
    role: UserRole = UserRole.USER
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserOut(UserBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ========== Competition / Season ==========
class CompetitionOut(BaseModel):
    id: int
    external_id: Optional[str] = None
    name: str
    code: Optional[str] = None
    country: Optional[str] = None
    type: Optional[str] = None
    data_source: DataSource
    model_config = ConfigDict(from_attributes=True)


class SeasonOut(BaseModel):
    id: int
    competition_id: int
    name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    current: bool = False
    data_source: DataSource
    model_config = ConfigDict(from_attributes=True)


# ========== Stadium / Team / Player ==========
class StadiumOut(BaseModel):
    id: int
    name: str
    city: Optional[str] = None
    country: Optional[str] = None
    capacity: Optional[int] = None
    model_config = ConfigDict(from_attributes=True)


class TeamBase(BaseModel):
    id: int
    name: str
    short_name: Optional[str] = None
    code: Optional[str] = None
    country: Optional[str] = None
    founded: Optional[int] = None
    stadium_id: Optional[int] = None
    logo_url: Optional[str] = None
    data_source: DataSource
    model_config = ConfigDict(from_attributes=True)


class TeamStatisticsOut(BaseModel):
    id: int
    team_id: int
    season_id: Optional[int] = None
    scope: str
    matches_played: int
    wins: int
    draws: int
    losses: int
    goals_for: float
    goals_against: float
    shots_per_90: float
    shots_on_target_per_90: float
    xg_per_90: float
    xga_per_90: float
    goals_conceded_per_90: float
    shots_conceded_per_90: float
    corners_per_90: float
    points_per_game: float
    recent_form: Optional[List[Any]] = None
    model_config = ConfigDict(from_attributes=True)


class TeamOut(TeamBase):
    statistics: List[TeamStatisticsOut] = []


class TeamDetailedOut(TeamBase):
    statistics: List[TeamStatisticsOut] = []
    stadium: Optional[StadiumOut] = None


class DefensiveWeaknessOut(BaseModel):
    id: int
    team_id: int
    zone: PitchZone
    weakness_score: float
    shots_conceded_per_90: float
    xga_per_90: float
    goals_conceded_per_90: float
    sample_size: int
    model_config = ConfigDict(from_attributes=True)


class PlayerBase(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: str
    display_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    country: Optional[str] = None
    nationality: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    preferred_foot: Optional[str] = None
    position: Optional[str] = None
    data_source: DataSource
    model_config = ConfigDict(from_attributes=True)


class PlayerStatisticsOut(BaseModel):
    id: int
    player_id: int
    season_id: Optional[int] = None
    scope: str
    matches_played: int
    minutes_played: int
    starts: int
    goals: int
    assists: int
    shots: int
    shots_on_target: int
    xg_total: float
    xa_total: float
    key_passes: int
    touches_in_box: int
    dribbles: int
    fouls_suffered: int
    tackles: int
    interceptions: int
    duels: int
    duels_won: int
    crosses: int
    shots_per_90: float
    shots_on_target_per_90: float
    xg_per_90: float
    xa_per_90: float
    key_passes_per_90: float
    touches_in_box_per_90: float
    corners_per_90: float
    goals_per_90: float
    assists_per_90: float
    tackle_pct: float
    dribble_success_pct: float
    pass_accuracy_pct: float
    pace: Optional[float] = None
    dribbling: Optional[float] = None
    recent_form: Optional[List[Any]] = None
    model_config = ConfigDict(from_attributes=True)


class PlayerZoneStatsOut(BaseModel):
    zone: PitchZone
    touches: int
    shots: int
    goals: int
    xg: float
    touches_per_90: float
    shots_per_90: float
    xg_per_90: float
    zone_frequency_pct: float
    offensive_strength: float
    model_config = ConfigDict(from_attributes=True)


class PlayerOut(PlayerBase):
    statistics: List[PlayerStatisticsOut] = []


class PlayerDetailedOut(PlayerBase):
    statistics: List[PlayerStatisticsOut] = []
    zone_statistics: List[PlayerZoneStatsOut] = []


# ========== Event / Shot / Pass / Goal ==========
class EventPositionOut(BaseModel):
    x: float
    y: float
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    zone: Optional[PitchZone] = None


class EventOut(BaseModel):
    id: int
    match_id: int
    team_id: int
    player_id: Optional[int] = None
    secondary_player_id: Optional[int] = None
    type: EventType
    minute: int
    second: Optional[int] = None
    period: Optional[str] = None
    outcome: Optional[str] = None
    position: Optional[EventPositionOut] = None
    details: Optional[Dict[str, Any]] = None
    model_config = ConfigDict(from_attributes=True)


# ========== Match ==========
class MatchTeamPreview(BaseModel):
    id: int
    name: str
    short_name: Optional[str] = None
    logo_url: Optional[str] = None


class LineupPlayer(BaseModel):
    player_id: int
    player_name: str
    is_starter: bool
    position: Optional[str] = None
    shirt_number: Optional[int] = None
    minutes_played: Optional[int] = None


class MatchOut(BaseModel):
    id: int
    season_id: int
    competition_name: Optional[str] = None
    round_name: Optional[str] = None
    matchday: Optional[int] = None
    kickoff_time: datetime
    status: str
    home_team: MatchTeamPreview
    away_team: MatchTeamPreview
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    stadium_name: Optional[str] = None
    referee: Optional[str] = None
    data_source: DataSource
    model_config = ConfigDict(from_attributes=True)


class MatchDetailedOut(MatchOut):
    lineups: Dict[str, List[LineupPlayer]] = {}
    events: List[EventOut] = []


class MatchAnalysisOut(BaseModel):
    match_id: int
    home_team_stats: Optional[TeamStatisticsOut] = None
    away_team_stats: Optional[TeamStatisticsOut] = None
    h2h_recent: List[Dict[str, Any]] = []
    form: Dict[str, List[Any]] = {}
    key_stats: Dict[str, Any] = {}


class PredictionGenerateRequest(BaseModel):
    match_id: int
    targets: List[Literal["shot", "shot_on_target", "goal", "goal_involvement"]] = Field(
        default_factory=lambda: ["shot", "goal"]
    )
    include_zone_details: bool = True
    include_matchups: bool = True


class PlayerMatchPrediction(BaseModel):
    player_id: int
    player_name: str
    team_id: int
    target: str
    probability: float
    baseline_probability: Optional[float] = None
    venue: Optional[str] = None
    confidence: str = "medium"
    positive_factors: List[Dict[str, Any]] = []
    negative_factors: List[Dict[str, Any]] = []
    zone_opportunities: List[ZoneOpportunity] = []
    model_version: Optional[str] = None


class PredictionGenerateResponse(BaseModel):
    match_id: int
    predictions: List[PlayerMatchPrediction] = []
    matchups: List[MatchupScore] = []
    generated_at: datetime = Field(default_factory=datetime.utcnow)


# ========== Data Import ==========
class DataImportRequest(BaseModel):
    provider: Literal["demo", "api_football", "statsbomb"]
    competition_codes: List[str] = []
    seasons: List[str] = []


class DataImportResponse(BaseModel):
    provider: str
    status: str
    message: str
    imported: Dict[str, int] = {}


# ========== Model ==========
class ModelVersionOut(BaseModel):
    id: int
    name: str
    version: str
    target: str
    algorithm: str
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1: Optional[float] = None
    roc_auc: Optional[float] = None
    log_loss: Optional[float] = None
    brier_score: Optional[float] = None
    is_active: bool
    feature_names: Optional[List[str]] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
