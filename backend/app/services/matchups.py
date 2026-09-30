from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from app.db.models import Player, PlayerStatistics
from app.services.utils import clamp, safe_div
from app.repositories.repositories import PlayerStatisticsRepository

player_stats_repo = PlayerStatisticsRepository()


def _player_offensive_attributes(stats: Optional[PlayerStatistics]) -> Dict[str, float]:
    if not stats:
        return {"dribbling": 0.5, "shooting": 0.5, "passing": 0.5, "pace": 0.6, "duel_strength": 0.5,
                "crossing": 0.5, "fouls_suffered_p90": 0.5, "touches_box_p90": 0.5, "xg_p90": 0.5}
    # Normalize to 0-1 using typical top ranges
    def _norm(v, vmax):
        return clamp(safe_div(v, vmax))
    return {
        "dribbling": stats.dribbling or _norm(stats.dribble_success_pct, 100) * 0.5 + _norm(stats.dribbles / max(1, stats.matches_played or 1), 5) * 0.5,
        "shooting": _norm(stats.shots_on_target_per_90, 3.5) * 0.5 + _norm(stats.xg_per_90, 0.7) * 0.5,
        "passing": _norm(stats.pass_accuracy_pct, 100) * 0.4 + _norm(stats.key_passes_per_90, 3.0) * 0.6,
        "pace": stats.pace or 0.65,
        "duel_strength": _norm((stats.duels_won / max(1, stats.duels or 1)), 1.0),
        "crossing": _norm(stats.crosses_completed / max(1, stats.crosses or 1), 1.0) * 0.5 + _norm(stats.crosses / max(1, stats.matches_played or 1), 4) * 0.5,
        "fouls_suffered_p90": _norm(stats.fouls_suffered / max(1, (stats.minutes_played or 1) / 90), 4.0),
        "touches_box_p90": _norm(stats.touches_in_box_per_90, 8.0),
        "xg_p90": _norm(stats.xg_per_90, 0.6),
    }


def _player_defensive_attributes(stats: Optional[PlayerStatistics]) -> Dict[str, float]:
    if not stats:
        return {"tackling": 0.5, "interception": 0.5, "aerial": 0.5, "duel_strength": 0.5,
                "defensive_workrate": 0.6, "marking": 0.5, "pace": 0.6}
    def _norm(v, vmax): return clamp(safe_div(v, vmax))
    return {
        "tackling": _norm(stats.tackle_pct, 100) * 0.6 + _norm(stats.tackles / max(1, stats.matches_played or 1), 4) * 0.4,
        "interception": _norm(stats.interceptions / max(1, stats.matches_played or 1), 3.5),
        "aerial": _norm(stats.clearances / max(1, stats.matches_played or 1), 6),
        "duel_strength": _norm((stats.duels_won / max(1, stats.duels or 1)), 1.0),
        "defensive_workrate": stats.defensive_workrate or 0.6,
        "marking": 0.6,
        "pace": stats.pace or 0.6,
    }


def compute_player_matchup(attacker: Player, defender: Player,
                           attacker_stats: Optional[PlayerStatistics],
                           defender_stats: Optional[PlayerStatistics]) -> Dict[str, Any]:
    a = _player_offensive_attributes(attacker_stats)
    d = _player_defensive_attributes(defender_stats)

    dimensions = {
        "pace_vs_pace": (a["pace"], d["pace"]),
        "dribble_vs_tackle": (a["dribbling"], d["tackling"]),
        "shoot_vs_marking": (a["shooting"], d["marking"]),
        "duel_off_vs_duel_def": (a["duel_strength"], d["duel_strength"]),
        "cross_vs_intercept": (a["crossing"], d["interception"]),
        "foul_suffered_vs_workrate": (a["fouls_suffered_p90"], d["defensive_workrate"]),
    }
    weights = {
        "pace_vs_pace": 0.15,
        "dribble_vs_tackle": 0.25,
        "shoot_vs_marking": 0.2,
        "duel_off_vs_duel_def": 0.15,
        "cross_vs_intercept": 0.1,
        "foul_suffered_vs_workrate": 0.15,
    }

    score = 0.0
    dim_scores = {}
    strengths_attacker = []
    weaknesses_defender = []
    evidence = []

    for dim, (a_v, d_v) in dimensions.items():
        w = weights[dim]
        diff = a_v - d_v
        dim_score = 0.5 + diff * 0.5  # 0..1
        dim_scores[dim] = clamp(dim_score)
        score += dim_score * w
        evidence.append({
            "dimension": dim,
            "attacker_value": round(a_v, 3),
            "defender_value": round(d_v, 3),
            "weight": w,
            "score_contribution": round(dim_score * w, 4),
        })
        if diff > 0.15:
            name_map = {
                "pace_vs_pace": "Attacker has pace advantage",
                "dribble_vs_tackle": "Dribbling beats tackle rate",
                "shoot_vs_marking": "Shooting profile vs suspect marking",
                "duel_off_vs_duel_def": "Attacker wins duels more often",
                "cross_vs_intercept": "Crossing vs low interception rate",
                "foul_suffered_vs_workrate": "Fouls drawn suggest pressure",
            }
            strengths_attacker.append(name_map.get(dim, dim))
        if diff < -0.1:
            name_map = {
                "pace_vs_pace": "Defender matches pace",
                "dribble_vs_tackle": "Strong tackle rate",
                "shoot_vs_marking": "Good central marking",
                "duel_off_vs_duel_def": "Defender wins duels",
                "cross_vs_intercept": "Good lane intercepting",
                "foul_suffered_vs_workrate": "High defensive workrate",
            }
            weaknesses_defender.append(name_map.get(dim, dim))

    return {
        "attacker_id": attacker.id,
        "defender_id": defender.id,
        "score": round(clamp(score), 4),
        "strengths": strengths_attacker,
        "weaknesses": weaknesses_defender,
        "evidence": evidence,
    }


def recommend_matchups(db: Session, attackers: List[Player], defenders: List[Player],
                       attacker_stats_map: Dict[int, PlayerStatistics],
                       defender_stats_map: Dict[int, PlayerStatistics],
                       top_n: int = 5) -> List[Dict[str, Any]]:
    all_matchups = []
    for a in attackers:
        for df in defenders:
            all_matchups.append(compute_player_matchup(a, df,
                                                       attacker_stats_map.get(a.id),
                                                       defender_stats_map.get(df.id)))
    all_matchups.sort(key=lambda m: m["score"], reverse=True)
    return all_matchups[:top_n]
