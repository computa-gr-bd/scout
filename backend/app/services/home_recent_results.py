"""Confirmed recent results for the Home panel, without changing analysis listings."""
from collections import defaultdict
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import DataSource, Match, Season
from app.services.match_reconciliation import MATCH_TIME_TOLERANCE
from app.services.scope import excluded_season_ids
from app.services.studio import norm_team

_SOURCES = (DataSource.UNDERSTAT, DataSource.PITCH_API)
_PAGE_SIZE = 64
_SQL_CHUNK = 300


def home_recent_results(db: Session, *, skip: int, limit: int) -> list[Match]:
    if limit <= 0:
        return []
    now = datetime.utcnow()
    eligible = (
        Match.data_source.in_(_SOURCES),
        Match.season_id.notin_(excluded_season_ids()),
        Match.kickoff_time <= now,
        func.lower(Match.status) == "finished",
        Match.home_score.isnot(None),
        Match.away_score.isnot(None),
    )
    options = (selectinload(Match.home_team), selectinload(Match.away_team),
               selectinload(Match.season).selectinload(Season.competition))
    groups: dict[int, dict[int, Match]] = {}
    expanded: set[int] = set()
    core: set[int] = set()

    def root_id(match: Match) -> int:
        return match.canonical_match_id or match.id

    def hydrate(roots: set[int]) -> None:
        missing = sorted(roots - groups.keys())
        for start in range(0, len(missing), _SQL_CHUNK):
            part = missing[start:start + _SQL_CHUNK]
            for root in part:
                groups[root] = {}
            siblings = db.scalars(
                select(Match).options(*options).where(
                    *eligible, or_(Match.id.in_(part), Match.canonical_match_id.in_(part))
                )
            ).all()
            for match in siblings:
                if root_id(match) in part:
                    groups[root_id(match)][match.id] = match

    def expand(roots: set[int]) -> None:
        pending = roots - expanded
        if not pending:
            return
        expanded.update(pending)
        intervals = sorted(
            (match.kickoff_time - MATCH_TIME_TOLERANCE, match.kickoff_time + MATCH_TIME_TOLERANCE)
            for root in pending for match in groups[root].values()
        )
        merged = []
        for start, end in intervals:
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
            else:
                merged.append((start, end))
        found: set[int] = set()
        for pos in range(0, len(merged), _SQL_CHUNK):
            windows = merged[pos:pos + _SQL_CHUNK]
            neighbors = db.scalars(
                select(Match).where(*eligible, or_(*(
                    and_(Match.kickoff_time >= start, Match.kickoff_time <= end)
                    for start, end in windows
                )))
            ).all()
            found.update(root_id(match) for match in neighbors)
        hydrate(found)

    def consolidate() -> list[Match]:
        keys: dict[tuple, list[tuple[datetime, int, Match]]] = defaultdict(list)
        sources = {root: {m.data_source for m in members.values()}
                   for root, members in groups.items()}
        for root, members in groups.items():
            for match in members.values():
                comp = match.season.competition
                code, country = (comp.code or "").strip().upper(), norm_team(comp.country)
                home, away = norm_team(match.home_team.name), norm_team(match.away_team.name)
                if code and country and home and away and home != away:
                    keys[(code, country, home, away)].append((match.kickoff_time, match.id, match))
        candidates: dict[int, set[int]] = defaultdict(set)
        for matches in keys.values():
            matches.sort(key=lambda item: (item[0], item[1]))
            for index, (kickoff, _, left) in enumerate(matches):
                a = root_id(left)
                for position in range(index + 1, len(matches)):
                    other_kickoff, _, right = matches[position]
                    if other_kickoff - kickoff > MATCH_TIME_TOLERANCE:
                        break
                    b = root_id(right)
                    if a == b or sources[a] & sources[b]:
                        continue
                    if any(x.country and y.country and norm_team(x.country) != norm_team(y.country)
                           for x, y in ((left.home_team, right.home_team),
                                        (left.away_team, right.away_team))):
                        continue
                    candidates[a].add(b)
                    candidates[b].add(a)
        results: dict[tuple[int, ...], Match] = {}
        for root in core:
            neighbors = candidates[root]
            pair = (root,)
            if len(neighbors) == 1:
                other = next(iter(neighbors))
                if candidates[other] == {root}:
                    pair = tuple(sorted((root, other)))
            members = (m for group in pair for m in groups[group].values())
            results[pair] = min(members, key=lambda m: (_SOURCES.index(m.data_source), m.id))
        return sorted(results.values(), key=lambda m: (m.kickoff_time, m.id), reverse=True)

    cursor = None
    while True:
        query = select(Match).where(*eligible).order_by(Match.kickoff_time.desc(), Match.id.desc()).limit(_PAGE_SIZE)
        if cursor is not None:
            query = query.where(or_(Match.kickoff_time < cursor[0],
                                    and_(Match.kickoff_time == cursor[0], Match.id < cursor[1])))
        page = db.scalars(query).all()
        if not page:
            break
        roots = {root_id(match) for match in page}
        hydrate(roots)
        core.update(roots)
        # Two hops are required: a candidate may itself have another match just
        # outside the first window, making the apparent pair ambiguous.
        expand(core)
        expand(set(groups))
        results = consolidate()
        cursor = (page[-1].kickoff_time, page[-1].id)
        if len(results) >= skip + limit:
            cutoff = results[skip + limit - 1]
            if (cutoff.kickoff_time, cutoff.id) >= cursor:
                return results[skip:skip + limit]
        if len(page) < _PAGE_SIZE:
            break
    return consolidate()[skip:skip + limit]
