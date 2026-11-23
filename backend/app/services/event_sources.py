"""Source preference for shot data when providers overlap on the same match."""
from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased

from app.db.models import DataSource, Event, EventType


def preferred_shot_event_ids():
    source_event = aliased(Event)
    source_priority = case(
        (source_event.data_source == DataSource.UNDERSTAT, 0),
        (source_event.data_source == DataSource.PITCH_API, 1),
        (source_event.data_source == DataSource.STATSBOMB, 2),
        (source_event.data_source == DataSource.API_FOOTBALL, 3),
        (source_event.data_source == DataSource.FOOTBALL_DATA, 4),
        (source_event.data_source == DataSource.MANUAL, 5),
        (source_event.data_source == DataSource.DEMO, 6),
        else_=99,
    )
    best_source_by_match = (
        select(
            source_event.match_id.label("match_id"),
            func.min(source_priority).label("source_priority"),
        )
        .where(source_event.type == EventType.SHOT)
        .group_by(source_event.match_id)
        .subquery()
    )
    return (
        select(source_event.id)
        .join(best_source_by_match, best_source_by_match.c.match_id == source_event.match_id)
        .where(
            source_event.type == EventType.SHOT,
            source_priority == best_source_by_match.c.source_priority,
        )
    )
