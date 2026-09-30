from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.db.models import Team, Match, PitchZone, ZONE_ORDER
from app.services.analytics import compute_team_statistics
from app.services.utils import clamp, safe_div, has_sufficient_sample
from app.repositories.repositories import DefensiveWeaknessRepository, MatchRepository

weakness_repo = DefensiveWeaknessRepository()
match_repo = MatchRepository()


ZONE_VULN_WEIGHTS = {
    PitchZone.CENTRAL_BOX: 1.6,
    PitchZone.OUTSIDE_BOX_CENTRAL: 1.2,
    PitchZone.OUTSIDE_BOX_LEFT: 1.1,
    PitchZone.OUTSIDE_BOX_RIGHT: 1.1,
    PitchZone.OPP_LEFT_CHANNEL: 1.0,
    PitchZone.OPP_RIGHT_CHANNEL: 1.0,
    PitchZone.OPP_CENTRAL_MIDFIELD: 0.8,
    PitchZone.OPP_LEFT_FLANK: 0.7,
    PitchZone.OPP_RIGHT_FLANK: 0.7,
    PitchZone.NEUTRAL_MIDFIELD: 0.5,
}


def compute_team_defensive_weaknesses(db: Session, team_id: int, matches: List[Match],
                                       season_id: Optional[int] = None) -> List[Dict[str, Any]]:
    results = []
    n_matches = len(matches)
    sample_sufficient = has_sufficient_sample(n_matches, threshold=3)

    for zone in ZONE_ORDER:
        # For each match/zone, synthetic weakness based on result and zone weight
        zone_base = 0.5
        weight = ZONE_VULN_WEIGHTS.get(zone, 0.4)
        if sample_sufficient:
            conceded_per_match = safe_div(sum(max(0, (m.away_score if m.home_team_id == team_id else m.home_score))
                                              for m in matches), n_matches)
            form_penalty = 1.0
            # if lost recent matches, increase vulnerability
            recent = sorted(matches, key=lambda m: m.kickoff_time, reverse=True)[:3]
            losses = sum(1 for m in recent if
                         (m.home_team_id == team_id and m.home_score < m.away_score) or
                         (m.away_team_id == team_id and m.away_score < m.home_score))
            form_penalty += losses * 0.08

            zone_vuln_raw = (0.3 + conceded_per_match * 0.12) * weight * form_penalty
            # Add zone-specific variation
            if zone in {PitchZone.CENTRAL_BOX, PitchZone.OUTSIDE_BOX_CENTRAL}:
                zone_vuln_raw *= (1.0 + (hash(str(team_id) + zone.value) % 30) / 100)
            weakness_score = clamp(zone_vuln_raw, 0.0, 1.0)
            shots_conceded_p90 = (conceded_per_match * 2.5 + 3.0) * weight
            xga_p90 = conceded_per_match * weight
            goals_conceded_p90 = conceded_per_match * weight * 0.35
        else:
            # small-sample fallback: use generic moderate weakness
            weakness_score = clamp(0.4 * weight, 0.0, 1.0)
            shots_conceded_p90 = 3.5 * weight
            xga_p90 = 0.6 * weight
            goals_conceded_p90 = 0.4 * weight

        results.append({
            "team_id": team_id,
            "season_id": season_id,
            "zone": zone,
            "weakness_score": round(weakness_score, 4),
            "shots_conceded_per_90": round(shots_conceded_p90, 3),
            "xga_per_90": round(xga_p90, 3),
            "goals_conceded_per_90": round(goals_conceded_p90, 3),
            "sample_size": n_matches,
            "notes": {"sample_sufficient": sample_sufficient, "zone_weight": weight},
        })
    return results
