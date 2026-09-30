from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.db.models import PitchZone, ZONE_ORDER
from app.repositories.repositories import (
    PlayerZoneStatsRepository, DefensiveWeaknessRepository
)

pz_repo = PlayerZoneStatsRepository()
dw_repo = DefensiveWeaknessRepository()


def compute_zone_opportunities(player_zone_stats: List[Any],
                               opponent_weaknesses: List[Any]) -> List[Dict[str, Any]]:
    dw_by_zone = {w.zone: w for w in opponent_weaknesses}
    pz_by_zone = {z.zone: z for z in player_zone_stats}

    results = []
    max_total_freq = sum(getattr(z, "zone_frequency_pct", 0) for z in player_zone_stats) or 1.0

    for zone in ZONE_ORDER:
        zs = pz_by_zone.get(zone)
        dw = dw_by_zone.get(zone)

        offensive_strength = float(getattr(zs, "offensive_strength", 0) or 0)
        defensive_weakness = float(getattr(dw, "weakness_score", 0) or 0)
        player_freq = float((getattr(zs, "zone_frequency_pct", 0) or 0) / max_total_freq) if max_total_freq else 0.0

        opportunity_score = offensive_strength * defensive_weakness * (0.4 + 0.6 * player_freq)
        # amplify final zones
        if zone in {PitchZone.CENTRAL_BOX, PitchZone.OUTSIDE_BOX_CENTRAL}:
            opportunity_score *= 1.25

        results.append({
            "zone": zone,
            "opportunity_score": round(float(opportunity_score), 5),
            "offensive_strength": round(offensive_strength, 4),
            "defensive_weakness": round(defensive_weakness, 4),
            "player_frequency": round(player_freq, 4),
        })
    results.sort(key=lambda x: x["opportunity_score"], reverse=True)
    return results
