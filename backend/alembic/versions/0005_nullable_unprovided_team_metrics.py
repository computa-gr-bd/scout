"""Represent provider metrics that are not supplied as unavailable."""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

UNAVAILABLE_METRICS = (
    "shots", "shots_on_target", "xg_total", "xga_total", "corners_total",
    "shots_per_90", "shots_on_target_per_90", "xg_per_90", "xga_per_90",
    "shots_conceded_per_90", "corners_per_90",
)


def upgrade():
    table = "team_statistics"
    for column in UNAVAILABLE_METRICS:
        op.alter_column(
            table, column, existing_type=sa.Float(), existing_nullable=False, nullable=True
        )
    op.execute(
        "UPDATE team_statistics SET "
        + ", ".join(f"{column} = NULL" for column in UNAVAILABLE_METRICS)
        + " WHERE team_id IN (SELECT id FROM team WHERE data_source = 'football_data')"
    )


def downgrade():
    table = "team_statistics"
    op.execute(
        "UPDATE team_statistics SET "
        + ", ".join(f"{column} = 0" for column in UNAVAILABLE_METRICS)
        + " WHERE team_id IN (SELECT id FROM team WHERE data_source = 'football_data')"
    )
    for column in UNAVAILABLE_METRICS:
        op.alter_column(
            table, column, existing_type=sa.Float(), existing_nullable=True, nullable=False
        )
