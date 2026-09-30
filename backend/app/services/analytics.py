from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.repositories.repositories import (
    TeamStatisticsRepository, PlayerStatisticsRepository,
    PlayerZoneStatsRepository, DefensiveWeaknessRepository,
    EventRepository, MatchRepository
)
from app.db.models import Match, PitchZone, EventType
from app.services.utils import per90, safe_div, clamp, has_sufficient_sample

team_stats_repo = TeamStatisticsRepository()
player_stats_repo = PlayerStatisticsRepository()
zone_stats_repo = PlayerZoneStatsRepository()
weakness_repo = DefensiveWeaknessRepository()
event_repo = EventRepository()
match_repo = MatchRepository()


def _recent_form_from_matches(matches: List[Match], team_id: int, n: int = 5) -> List[Dict[str, Any]]:
    out = []
    for m in matches[:n]:
        is_home = m.home_team_id == team_id
        gf = m.home_score if is_home else m.away_score
        ga = m.away_score if is_home else m.home_score
        result = "W" if gf > ga else ("D" if gf == ga else "L")
        out.append({
            "match_id": m.id,
            "opponent_id": m.away_team_id if is_home else m.home_team_id,
            "result": result,
            "gf": gf, "ga": ga,
        })
    return out


def compute_team_statistics(db: Session, team_id: int, matches: List[Match],
                            scope: str = "overall") -> Dict[str, Any]:
    total_matches = len(matches)
    if total_matches == 0:
        return {
            "team_id": team_id, "scope": scope,
            "matches_played": 0, "wins": 0, "draws": 0, "losses": 0,
            "goals_for": 0, "goals_against": 0, "shots": 0, "shots_on_target": 0,
            "xg_total": 0, "xga_total": 0, "corners_total": 0,
            "shots_per_90": 0, "shots_on_target_per_90": 0, "xg_per_90": 0,
            "xga_per_90": 0, "goals_conceded_per_90": 0, "shots_conceded_per_90": 0,
            "corners_per_90": 0, "points_per_game": 0, "recent_form": [],
        }
    wins = draws = losses = 0
    gf = ga = 0
    shots_f = shots_a = 0
    shots_on_target_f = shots_on_target_a = 0
    xg_f = xg_a = 0
    corners_taken = 0
    points = 0
    total_minutes = total_matches * 90
    sorted_matches = sorted(matches, key=lambda m: m.kickoff_time, reverse=True)

    for m in sorted_matches:
        is_home = m.home_team_id == team_id
        team_gf = m.home_score if is_home else m.away_score
        team_ga = m.away_score if is_home else m.home_score
        gf += team_gf
        ga += team_ga
        if team_gf > team_ga:
            wins += 1; points += 3
        elif team_gf == team_ga:
            draws += 1; points += 1
        else:
            losses += 1
        # synthetic shots from score/result - will be replaced when event data available
        # use simple heuristic: ~12-18 shots per game, stronger teams more
        base_shots = 13 + (2 if (team_gf > team_ga) else 0) + (team_gf * 2)
        opp_base_shots = 11 + (team_ga * 2)
        shots_f += base_shots
        shots_a += opp_base_shots
        shots_on_target_f += int(base_shots * 0.33) + team_gf
        shots_on_target_a += int(opp_base_shots * 0.33) + team_ga
        xg_f += team_gf * 0.9 + (base_shots * 0.09)
        xg_a += team_ga * 0.9 + (opp_base_shots * 0.09)
        corners_taken += 4 + team_gf

    recent_form = _recent_form_from_matches(sorted_matches, team_id, n=5)
    return {
        "team_id": team_id, "scope": scope,
        "matches_played": total_matches, "wins": wins, "draws": draws, "losses": losses,
        "goals_for": float(gf), "goals_against": float(ga),
        "shots": float(shots_f), "shots_on_target": float(shots_on_target_f),
        "xg_total": float(xg_f), "xga_total": float(xg_a),
        "corners_total": float(corners_taken),
        "shots_per_90": per90(shots_f, total_minutes),
        "shots_on_target_per_90": per90(shots_on_target_f, total_minutes),
        "xg_per_90": per90(xg_f, total_minutes),
        "xga_per_90": per90(xg_a, total_minutes),
        "goals_conceded_per_90": per90(ga, total_minutes),
        "shots_conceded_per_90": per90(shots_a, total_minutes),
        "corners_per_90": per90(corners_taken, total_minutes),
        "points_per_game": safe_div(points, total_matches),
        "recent_form": recent_form,
    }


def compute_player_statistics(db: Session, player_id: int, per_game_stats: List[Dict[str, Any]],
                               scope: str = "overall") -> Dict[str, Any]:
    if not per_game_stats:
        return {
            "player_id": player_id, "scope": scope,
            "matches_played": 0, "minutes_played": 0, "starts": 0,
            "goals": 0, "assists": 0, "shots": 0, "shots_on_target": 0,
            "xg_total": 0, "xa_total": 0, "passes": 0, "passes_completed": 0,
            "key_passes": 0, "touches_in_box": 0, "dribbles": 0, "dribbles_success": 0,
            "fouls_suffered": 0, "fouls_committed": 0, "tackles": 0,
            "interceptions": 0, "clearances": 0, "duels": 0, "duels_won": 0,
            "crosses": 0, "crosses_completed": 0, "corners_taken": 0,
            "shots_per_90": 0, "shots_on_target_per_90": 0, "xg_per_90": 0,
            "xa_per_90": 0, "key_passes_per_90": 0, "touches_in_box_per_90": 0,
            "corners_per_90": 0, "goals_per_90": 0, "assists_per_90": 0,
            "tackle_pct": 0, "dribble_success_pct": 0, "pass_accuracy_pct": 0,
        }
    totals: Dict[str, float] = {}
    for s in per_game_stats:
        for k, v in s.items():
            if isinstance(v, (int, float)):
                totals[k] = totals.get(k, 0) + v
    minutes = totals.get("minutes_played", 0)
    starts = int(sum(1 for s in per_game_stats if s.get("is_starter")))
    recent_form = [{"minutes_played": s.get("minutes_played", 0), "rating": s.get("rating")}
                   for s in per_game_stats[-5:]]
    return {
        "player_id": player_id, "scope": scope,
        "matches_played": len(per_game_stats), "minutes_played": int(minutes), "starts": starts,
        "goals": int(totals.get("goals", 0)), "assists": int(totals.get("assists", 0)),
        "shots": int(totals.get("shots", 0)), "shots_on_target": int(totals.get("shots_on_target", 0)),
        "xg_total": float(totals.get("xg", 0)), "xa_total": float(totals.get("xa", 0)),
        "passes": int(totals.get("passes", 0)), "passes_completed": int(totals.get("passes_completed", 0)),
        "key_passes": int(totals.get("key_passes", 0)), "touches_in_box": int(totals.get("touches_in_box", 0)),
        "dribbles": int(totals.get("dribbles", 0)), "dribbles_success": int(totals.get("dribbles_success", 0)),
        "fouls_suffered": int(totals.get("fouls_suffered", 0)),
        "fouls_committed": int(totals.get("fouls_committed", 0)),
        "tackles": int(totals.get("tackles", 0)), "interceptions": int(totals.get("interceptions", 0)),
        "clearances": int(totals.get("clearances", 0)), "duels": int(totals.get("duels", 0)),
        "duels_won": int(totals.get("duels_won", 0)), "crosses": int(totals.get("crosses", 0)),
        "crosses_completed": int(totals.get("crosses_completed", 0)),
        "corners_taken": int(totals.get("corners_taken", 0)),
        "shots_per_90": per90(totals.get("shots", 0), minutes),
        "shots_on_target_per_90": per90(totals.get("shots_on_target", 0), minutes),
        "xg_per_90": per90(totals.get("xg", 0), minutes),
        "xa_per_90": per90(totals.get("xa", 0), minutes),
        "key_passes_per_90": per90(totals.get("key_passes", 0), minutes),
        "touches_in_box_per_90": per90(totals.get("touches_in_box", 0), minutes),
        "corners_per_90": per90(totals.get("corners_taken", 0), minutes),
        "goals_per_90": per90(totals.get("goals", 0), minutes),
        "assists_per_90": per90(totals.get("assists", 0), minutes),
        "tackle_pct": clamp(safe_div(totals.get("tackles", 0), max(1, totals.get("duels_defensive", 0)) or (totals.get("tackles", 0) + 1)) * 100, 0, 100),
        "dribble_success_pct": clamp(safe_div(totals.get("dribbles_success", 0), max(1, totals.get("dribbles", 0))) * 100, 0, 100),
        "pass_accuracy_pct": clamp(safe_div(totals.get("passes_completed", 0), max(1, totals.get("passes", 0))) * 100, 0, 100),
        "recent_form": recent_form,
    }


def home_advantage_factor(is_home: bool) -> float:
    return 1.08 if is_home else 0.92
