"""add targeted query indexes for match, lineup, stats and standings

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_match_season_kickoff", "match", ["season_id", "kickoff_time"], unique=False)
    op.create_index("ix_lineup_match_team", "lineup", ["match_id", "team_id"], unique=False)
    op.create_index("ix_lineup_player_match", "lineup", ["player_id", "match_id"], unique=False)
    op.create_index("ix_event_match_type", "event", ["match_id", "type"], unique=False)
    op.create_index("ix_event_player_match", "event", ["player_id", "match_id"], unique=False)
    op.create_index("ix_team_statistics_team_season_scope", "team_statistics", ["team_id", "season_id", "scope"], unique=False)
    op.create_index("ix_player_statistics_player_season_scope", "player_statistics", ["player_id", "season_id", "scope"], unique=False)
    op.create_index("ix_standing_season_group_position", "standing", ["season_id", "group_name", "position"], unique=False)
    op.create_index("ix_player_match_statistics_match_player", "player_match_statistics", ["match_id", "player_id"], unique=False)
    op.create_index("ix_defensive_weakness_team_season_zone", "defensive_weakness", ["team_id", "season_id", "zone"], unique=False)
    op.create_index("ix_player_zone_statistics_player_season_zone", "player_zone_statistics", ["player_id", "season_id", "zone"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_player_zone_statistics_player_season_zone", table_name="player_zone_statistics")
    op.drop_index("ix_defensive_weakness_team_season_zone", table_name="defensive_weakness")
    op.drop_index("ix_player_match_statistics_match_player", table_name="player_match_statistics")
    op.drop_index("ix_standing_season_group_position", table_name="standing")
    op.drop_index("ix_player_statistics_player_season_scope", table_name="player_statistics")
    op.drop_index("ix_team_statistics_team_season_scope", table_name="team_statistics")
    op.drop_index("ix_event_player_match", table_name="event")
    op.drop_index("ix_event_match_type", table_name="event")
    op.drop_index("ix_lineup_player_match", table_name="lineup")
    op.drop_index("ix_lineup_match_team", table_name="lineup")
    op.drop_index("ix_match_season_kickoff", table_name="match")
