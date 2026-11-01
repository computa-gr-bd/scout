"""preserve supplemental player stats from data providers

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "player_statistics",
        sa.Column("supplemental_stats", sa.JSON(), nullable=True),
    )
    op.add_column(
        "player_statistics",
        sa.Column("aerials_won", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "player_statistics",
        sa.Column("aerials_lost", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "player_match_statistics",
        sa.Column("supplemental_stats", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("player_match_statistics", "supplemental_stats")
    op.drop_column("player_statistics", "aerials_lost")
    op.drop_column("player_statistics", "aerials_won")
    op.drop_column("player_statistics", "supplemental_stats")
