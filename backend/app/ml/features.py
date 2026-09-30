from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
import math

import numpy as np
import pandas as pd

from app.db.models import PlayerStatistics, TeamStatistics, DefensiveWeakness, PlayerZoneStatistics
from app.services.utils import clamp, safe_div


TARGET_SHOT = "shot"
TARGET_SHOT_ON_TARGET = "shot_on_target"
TARGET_GOAL = "goal"
TARGET_GOAL_INVOLVEMENT = "goal_involvement"

TARGET_BASELINE = {
    TARGET_SHOT: 0.28,
    TARGET_SHOT_ON_TARGET: 0.14,
    TARGET_GOAL: 0.06,
    TARGET_GOAL_INVOLVEMENT: 0.10,
}


FEATURE_NAMES = [
    "player_shots_per_90",
    "player_sot_per_90",
    "player_xg_per_90",
    "player_xa_per_90",
    "player_key_passes_per_90",
    "player_touches_box_per_90",
    "player_minutes_ratio",
    "team_shots_per_90",
    "team_xg_per_90",
    "team_attack_volume",
    "opponent_shots_conceded_per_90",
    "opponent_xga_per_90",
    "opponent_goals_conceded_per_90",
    "opponent_weakness_score_max",
    "opponent_weakness_score_weighted",
    "home_advantage",
    "player_recent_form_score",
    "team_recent_form_score",
    "player_zone_strength",
    "player_corners_per_90",
]


@dataclass
class PredictionContext:
    player_id: int
    team_id: int
    opponent_team_id: int
    is_home: bool
    player_stats: Optional[PlayerStatistics]
    team_stats: Optional[TeamStatistics]
    opponent_stats: Optional[TeamStatistics]
    opponent_weaknesses: List[DefensiveWeakness]
    player_zone_stats: List[PlayerZoneStatistics]
    player_recent: List[Dict[str, Any]] = field(default_factory=list)
    team_recent: List[Dict[str, Any]] = field(default_factory=list)


def _recent_form_score(form_list: List[Dict[str, Any]], kind: str = "team") -> float:
    if not form_list:
        return 0.5
    score = 0.0
    for i, f in enumerate(form_list):
        decay = 1.0 / (1.0 + i * 0.25)
        if kind == "team":
            r = f.get("result")
            if r == "W": score += 1.0 * decay
            elif r == "D": score += 0.4 * decay
            else: score += 0.05 * decay
        else:
            mins = float(f.get("minutes_played") or 0)
            score += clamp(mins / 90.0) * decay
            rating = f.get("rating")
            if rating is not None:
                score += clamp((rating - 5.0) / 5.0) * decay * 0.5
    return clamp(score / max(1, len(form_list)))


def extract_features(ctx: PredictionContext) -> Dict[str, float]:
    ps = ctx.player_stats
    ts = ctx.team_stats
    os_ = ctx.opponent_stats

    def g(o, k, default=0.0):
        return float(getattr(o, k, default) or default) if o is not None else default

    minutes_ratio = clamp(safe_div(g(ps, "minutes_played"), max(1, g(ps, "matches_played")) * 90.0))

    weakness_scores = [float(getattr(w, "weakness_score", 0) or 0) for w in ctx.opponent_weaknesses]
    weakness_max = max(weakness_scores) if weakness_scores else 0.0
    weakness_weights = [float(getattr(w, "weakness_score", 0) or 0) * float(getattr(w, "sample_size", 1) or 1)
                        for w in ctx.opponent_weaknesses]
    weakness_weighted = clamp(safe_div(sum(weakness_weights), max(1, sum(float(getattr(w, "sample_size", 1) or 1) for w in ctx.opponent_weaknesses))))

    # player zone strength: weighted sum of offensive_strength x zone weakness
    dw_by_zone = {w.zone: float(getattr(w, "weakness_score", 0) or 0) for w in ctx.opponent_weaknesses}
    zone_strength = 0.0
    for z in ctx.player_zone_stats:
        z_offensive = float(getattr(z, "offensive_strength", 0) or 0)
        z_freq = clamp(float(getattr(z, "zone_frequency_pct", 0) or 0))
        zone_strength += z_offensive * z_freq * (0.5 + dw_by_zone.get(z.zone, 0.0))
    zone_strength = clamp(zone_strength)

    attack_volume = clamp(safe_div(g(ts, "shots_per_90") + g(ts, "xg_per_90") * 2 + g(ts, "corners_per_90"),
                                   (18 + 1.2 + 6)))

    return {
        "player_shots_per_90": clamp(g(ps, "shots_per_90") / 6.0),
        "player_sot_per_90": clamp(g(ps, "shots_on_target_per_90") / 3.0),
        "player_xg_per_90": clamp(g(ps, "xg_per_90") / 0.9),
        "player_xa_per_90": clamp(g(ps, "xa_per_90") / 0.6),
        "player_key_passes_per_90": clamp(g(ps, "key_passes_per_90") / 3.5),
        "player_touches_box_per_90": clamp(g(ps, "touches_in_box_per_90") / 10.0),
        "player_minutes_ratio": minutes_ratio,
        "team_shots_per_90": clamp(g(ts, "shots_per_90") / 22.0),
        "team_xg_per_90": clamp(g(ts, "xg_per_90") / 2.5),
        "team_attack_volume": attack_volume,
        "opponent_shots_conceded_per_90": clamp(g(os_, "shots_conceded_per_90") / 25.0),
        "opponent_xga_per_90": clamp(g(os_, "xga_per_90") / 3.0),
        "opponent_goals_conceded_per_90": clamp(g(os_, "goals_conceded_per_90") / 3.5),
        "opponent_weakness_score_max": weakness_max,
        "opponent_weakness_score_weighted": weakness_weighted,
        "home_advantage": 1.0 if ctx.is_home else 0.0,
        "player_recent_form_score": _recent_form_score(ctx.player_recent, kind="player"),
        "team_recent_form_score": _recent_form_score(ctx.team_recent, kind="team"),
        "player_zone_strength": zone_strength,
        "player_corners_per_90": clamp(g(ps, "corners_per_90") / 4.0),
    }


def features_to_array(features: Dict[str, float]) -> np.ndarray:
    return np.array([features[name] for name in FEATURE_NAMES], dtype=np.float64).reshape(1, -1)
