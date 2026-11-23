"""Season totals from verified PitchAPI match statistics, kept separate from Understat."""
from collections import Counter, defaultdict
from math import isfinite

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.db.models import DataSource, Match, TeamMatchStatistics
from app.services.pitchapi_sync import LEAGUE_IDS


def pitchapi_team_totals(db: Session, season_id: int, league_code: str | None) -> dict[int, dict]:
    league_id = LEAGUE_IDS.get(league_code or "")
    if not league_id:
        return {}
    source = aliased(Match)
    rows = db.execute(
        select(Match, TeamMatchStatistics, source.id)
        .join(source, source.canonical_match_id == Match.id)
        .join(TeamMatchStatistics, TeamMatchStatistics.match_id == Match.id)
        .where(
            Match.season_id == season_id,
            Match.canonical_match_id.is_(None),
            Match.data_source != DataSource.PITCH_API,
            Match.status == "finished",
            source.data_source == DataSource.PITCH_API,
            source.external_id.startswith(f"{league_id}:"),
        )
    ).all()
    matches: dict[int, dict] = {}
    for match, stats, source_id in rows:
        entry = matches.setdefault(match.id, {"match": match, "sources": set(), "stats": {}})
        entry["sources"].add(source_id)
        entry["stats"][stats.team_id] = stats

    identities = Counter(
        (entry["match"].home_team_id, entry["match"].away_team_id, entry["match"].kickoff_time.date())
        for entry in matches.values()
    )
    totals: dict[int, dict] = defaultdict(lambda: {"matches_played": 0, "xg": 0.0, "xga": 0.0, "shots": 0})
    for entry in matches.values():
        match = entry["match"]
        identity = (match.home_team_id, match.away_team_id, match.kickoff_time.date())
        if len(entry["sources"]) != 1 or identities[identity] != 1:
            continue
        mapped = {}
        for team_id in (match.home_team_id, match.away_team_id):
            stat = entry["stats"].get(team_id)
            provider = (stat.supplemental_stats or {}).get("pitchapi", {}) if stat else {}
            values = provider.get("mapped_match_stats", {}) if isinstance(provider, dict) else {}
            if not isinstance(values, dict):
                break
            xg, shots = values.get("xg"), values.get("shots")
            if any(
                isinstance(value, bool) or not isinstance(value, (int, float))
                or not isfinite(value) or value < 0
                for value in (xg, shots)
            ) or not float(shots).is_integer():
                break
            mapped[team_id] = (float(xg), int(shots))
        if len(mapped) != 2:
            continue
        for team_id, opponent_id in ((match.home_team_id, match.away_team_id), (match.away_team_id, match.home_team_id)):
            total = totals[team_id]
            total["matches_played"] += 1
            total["xg"] += mapped[team_id][0]
            total["xga"] += mapped[opponent_id][0]
            total["shots"] += mapped[team_id][1]
    return {
        team_id: {**values, "xg": round(values["xg"], 2), "xga": round(values["xga"], 2)}
        for team_id, values in totals.items()
    }
