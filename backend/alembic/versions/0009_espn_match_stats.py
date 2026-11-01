"""store supplemental ESPN match and goalkeeper statistics

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for column in ("saves", "goals_conceded", "shots_faced"):
        op.add_column(
            "player_match_statistics",
            sa.Column(column, sa.Integer(), nullable=False, server_default="0"),
        )
    op.add_column(
        "team_match_statistics",
        sa.Column("clearances", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "team_match_statistics",
        sa.Column("shots_blocked", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "team_match_statistics",
        sa.Column("supplemental_stats", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("team_match_statistics", "supplemental_stats")
    op.drop_column("team_match_statistics", "shots_blocked")
    op.drop_column("team_match_statistics", "clearances")
    for column in ("shots_faced", "goals_conceded", "saves"):
        op.drop_column("player_match_statistics", column)
