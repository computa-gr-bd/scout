from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import Match, Player, Team, User
from app.repositories.repositories import (
    MatchRepository, TeamRepository, PlayerRepository, TeamStatisticsRepository,
    PlayerStatisticsRepository, DefensiveWeaknessRepository, PlayerZoneStatsRepository,
    MatchPredictionRepository, ModelVersionRepository, Lineup
)
from app.ml.features import (
    PredictionContext, extract_features, features_to_array,
    TARGET_SHOT, TARGET_SHOT_ON_TARGET, TARGET_GOAL, TARGET_GOAL_INVOLVEMENT, TARGET_BASELINE,
)
from app.ml.models import model_store
from app.services.zones import compute_zone_opportunities
from app.services.matchups import recommend_matchups
from app.services.analytics import home_advantage_factor
from app.services.utils import clamp

match_repo = MatchRepository()
team_repo = TeamRepository()
player_repo = PlayerRepository()
team_stats_repo = TeamStatisticsRepository()
player_stats_repo = PlayerStatisticsRepository()
dw_repo = DefensiveWeaknessRepository()
pz_repo = PlayerZoneStatsRepository()
pred_repo = MatchPredictionRepository()
model_ver_repo = ModelVersionRepository()


TARGETS = {TARGET_SHOT, TARGET_SHOT_ON_TARGET, TARGET_GOAL, TARGET_GOAL_INVOLVEMENT}


def _confidence(prob: float, baseline: float) -> str:
    delta = abs(prob - baseline)
    if delta >= 0.08:
        return "high"
    if delta >= 0.03:
        return "medium"
    return "low"


def build_context(db: Session, player: Player, match: Match, is_home: bool,
                  team_id: int, opponent_team_id: int,
                  season_id: Optional[int] = None) -> PredictionContext:
    ps = player_stats_repo.for_player(db, player.id, season_id=season_id)
    ts = team_stats_repo.for_team(db, team_id, season_id=season_id)
    os_ = team_stats_repo.for_team(db, opponent_team_id, season_id=season_id)
    opp_w = dw_repo.for_team(db, opponent_team_id, season_id=season_id)
    pz = pz_repo.for_player(db, player.id, season_id=season_id)
    team_detailed = team_repo.get_detailed(db, team_id)
    team_recent = []
    if team_detailed and team_detailed.statistics:
        team_recent = team_detailed.statistics[0].recent_form or []
    player_recent = ps.recent_form if ps and ps.recent_form else []
    return PredictionContext(
        player_id=player.id,
        team_id=team_id,
        opponent_team_id=opponent_team_id,
        is_home=is_home,
        player_stats=ps,
        team_stats=ts,
        opponent_stats=os_,
        opponent_weaknesses=opp_w,
        player_zone_stats=pz,
        player_recent=player_recent,
        team_recent=team_recent,
    )


def predict_for_player(db: Session, player: Player, match: Match, target: str,
                       team_id: int, opponent_team_id: int, is_home: bool,
                       include_zone_details: bool = True) -> Dict[str, Any]:
    if target not in TARGETS:
        raise ValueError(f"Unknown target: {target}")
    ctx = build_context(db, player, match, is_home, team_id, opponent_team_id)
    features = extract_features(ctx)
    X = features_to_array(features)
    prob, positive, negative = model_store.predict(X, target)
    meta = model_store.metadata(target)
    baseline = TARGET_BASELINE[target]

    # venue/home adjustment (small)
    home_mult = home_advantage_factor(is_home)
    if is_home:
        prob = clamp(prob * 1.05)
    else:
        prob = clamp(prob * 0.95)

    zone_details = []
    if include_zone_details:
        try:
            zone_details = compute_zone_opportunities(ctx.player_zone_stats, ctx.opponent_weaknesses)
        except Exception:
            zone_details = []

    display = player.display_name or f"{player.first_name or ''} {player.last_name}".strip() or player.last_name

    return {
        "player_id": player.id,
        "player_name": display,
        "team_id": team_id,
        "target": target,
        "probability": round(float(prob), 4),
        "baseline_probability": round(float(baseline), 4),
        "venue": "home" if is_home else "away",
        "confidence": _confidence(prob, baseline),
        "positive_factors": positive,
        "negative_factors": negative,
        "zone_opportunities": zone_details,
        "model_version": f"{meta['name']}@{meta['version']}",
    }


def generate_match_predictions(db: Session, match: Match,
                               targets: List[str],
                               include_zone_details: bool = True,
                               include_matchups: bool = True) -> Dict[str, Any]:
    home_id = match.home_team_id
    away_id = match.away_team_id
    home_players = player_repo.by_team_in_match(db, match.id, home_id)
    away_players = player_repo.by_team_in_match(db, match.id, away_id)

    if not home_players:
        # Fallback: all players of the team
        home_players = player_repo.list(db, limit=20, filters=[Lineup.team_id == home_id] if False else [],
                                         order_by=None)  # not directly joined
        home_players = _team_players_heuristic(db, home_id)
    if not away_players:
        away_players = _team_players_heuristic(db, away_id)

    predictions: List[Dict[str, Any]] = []

    for p in home_players:
        for t in targets:
            predictions.append(predict_for_player(db, p, match, t, home_id, away_id,
                                                   is_home=True, include_zone_details=include_zone_details))
    for p in away_players:
        for t in targets:
            predictions.append(predict_for_player(db, p, match, t, away_id, home_id,
                                                   is_home=False, include_zone_details=include_zone_details))

    # sort each target by probability desc
    matchups: List[Dict[str, Any]] = []
    if include_matchups:
        home_stats_map = {p.id: player_stats_repo.for_player(db, p.id) for p in home_players}
        away_stats_map = {p.id: player_stats_repo.for_player(db, p.id) for p in away_players}
        # Attackers (home) vs defenders (away), and vice-versa
        def attackers(lst):
            atk_pos = {"FW", "ST", "RW", "LW", "CF", "AM", "FWD", "MID", "ATT", "Forward", "Midfielder"}
            return [p for p in lst if (p.position and any(a in (p.position or "").upper() for a in ("F", "W", "AM", "ST"))) ] or lst[:6]
        def defenders(lst):
            def_pos = {"CB", "LB", "RB", "GK", "CDM", "DF", "DEF"}
            return [p for p in lst if (p.position and any(d in (p.position or "").upper() for d in ("CB", "LB", "RB", "GK", "CDM", "DF")))] or lst[-6:]
        m1 = recommend_matchups(db, attackers(home_players), defenders(away_players),
                                home_stats_map, away_stats_map, top_n=5)
        m2 = recommend_matchups(db, attackers(away_players), defenders(home_players),
                                away_stats_map, home_stats_map, top_n=5)
        matchups = m1 + m2

    return {
        "match_id": match.id,
        "predictions": predictions,
        "matchups": matchups,
        "generated_at": datetime.utcnow(),
    }


def _team_players_heuristic(db: Session, team_id: int) -> List[Player]:
    from app.db.models import PlayerMatchStatistics
    from sqlalchemy import select, and_
    q = (select(Player).join(PlayerMatchStatistics, PlayerMatchStatistics.player_id == Player.id)
         .where(PlayerMatchStatistics.team_id == team_id)
         .limit(14))
    return list(db.scalars(q).all())


def persist_predictions(db: Session, match_id: int, payload: Dict[str, Any]) -> int:
    saved = 0
    for p in payload.get("predictions", []):
        obj = {
            "match_id": match_id,
            "player_id": p["player_id"],
            "team_id": p["team_id"],
            "opponent_team_id": (payload["_home_id"] if p["team_id"] != payload.get("_home_id") else payload.get("_away_id")),
            "target": p["target"],
            "probability": p["probability"],
            "baseline_probability": p["baseline_probability"],
            "venue": p["venue"],
            "confidence": p["confidence"],
            "factors": {"positive": p.get("positive_factors"), "negative": p.get("negative_factors")},
            "zones": [z for z in p.get("zone_opportunities", [])],
        }
        # opponent team lookup
        # Skip for now; persist via repository
        try:
            pred_repo.create(db, obj)
            saved += 1
        except Exception:
            db.rollback()
    if saved:
        db.commit()
    return saved
