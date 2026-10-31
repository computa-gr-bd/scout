from collections import defaultdict
from datetime import timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.db.models import Competition, DataSource, Match, Season, Team
from app.services.studio import _same_team_name, norm_team

MATCH_TIME_TOLERANCE = timedelta(hours=6)
SOURCE_PRIORITY = {
    DataSource.UNDERSTAT: 0,
    DataSource.FOOTBALL_DATA: 1,
    DataSource.STATSBOMB: 2,
    DataSource.API_FOOTBALL: 3,
    DataSource.MANUAL: 4,
    DataSource.DEMO: 5,
}


def reconcile_matches(db: Session) -> dict[str, int]:
    """Link equivalent cross-provider fixtures without deleting source rows.

    Provider IDs and foreign-key relationships remain attached to each source
    row; this pointer only selects which row appears as the canonical fixture.
    """
    home_team = aliased(Team)
    away_team = aliased(Team)
    rows = db.execute(
        select(
            Match,
            home_team.name,
            away_team.name,
            Competition.code,
            Competition.country,
        )
        .join(home_team, home_team.id == Match.home_team_id)
        .join(away_team, away_team.id == Match.away_team_id)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
    ).all()

    grouped = defaultdict(list)
    for match, home_name, away_name, code, country in rows:
        if not code or not country:
            continue
        grouped[(code.strip().upper(), norm_team(country))].append(
            (match, norm_team(home_name), norm_team(away_name))
        )

    candidates: list[tuple[int, int]] = []
    for fixtures in grouped.values():
        fixtures.sort(key=lambda item: (item[0].kickoff_time, item[0].id))
        for index, (left, home_left, away_left) in enumerate(fixtures):
            for right, home_right, away_right in fixtures[index + 1:]:
                if right.kickoff_time - left.kickoff_time > MATCH_TIME_TOLERANCE:
                    break
                if left.data_source == right.data_source:
                    continue
                if not (
                    _same_team_name(home_left, home_right)
                    and _same_team_name(away_left, away_right)
                ):
                    continue
                candidates.append((left.id, right.id))

    matches = {match.id: match for match, *_ in rows}
    parent = {match_id: match_id for match_id in matches}
    sources = {match_id: {match.data_source} for match_id, match in matches.items()}

    def find(match_id: int) -> int:
        while parent[match_id] != match_id:
            parent[match_id] = parent[parent[match_id]]
            match_id = parent[match_id]
        return match_id

    linked_pairs = 0
    for left_id, right_id in candidates:
        left_root, right_root = find(left_id), find(right_id)
        if left_root == right_root or sources[left_root] & sources[right_root]:
            continue
        parent[right_root] = left_root
        sources[left_root].update(sources.pop(right_root))
        linked_pairs += 1

    clusters = defaultdict(list)
    for match_id, match in matches.items():
        clusters[find(match_id)].append(match)

    linked_rows = 0
    for cluster in clusters.values():
        if len(cluster) < 2:
            canonical = cluster[0]
            canonical.canonical_match_id = None
            continue
        canonical = min(
            cluster,
            key=lambda match: (SOURCE_PRIORITY.get(match.data_source, 99), match.id),
        )
        for match in cluster:
            target: Optional[int] = None if match.id == canonical.id else canonical.id
            if match.canonical_match_id != target:
                match.canonical_match_id = target
            if target is not None:
                linked_rows += 1

    db.flush()
    return {"candidate_pairs": len(candidates), "linked_pairs": linked_pairs, "linked_rows": linked_rows}
