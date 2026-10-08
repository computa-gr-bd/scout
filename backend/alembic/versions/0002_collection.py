"""Provider identity, nullable scores and bounded collection checkpoints."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE datasource ADD VALUE IF NOT EXISTS 'football_data'")
    for table in ("competition", "stadium", "team", "player", "match", "event"):
        op.create_unique_constraint(
            f"uq_{table}_source_external", table, ["data_source", "external_id"]
        )
    for column in ("home_score", "away_score"):
        op.alter_column("match", column, existing_type=sa.Integer(),
                        nullable=True, server_default=None)
    op.create_table(
        "collection_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("resource", sa.String(128), nullable=False),
        sa.Column("last_success_at", sa.DateTime()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("summary", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", "resource", name="uq_collection_resource"),
    )
    op.create_table(
        "standing",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("season.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("team.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_name", sa.String(64), nullable=False),
        *(sa.Column(name, sa.Integer()) for name in (
            "position", "played", "won", "draw", "lost", "points",
            "goals_for", "goals_against", "goal_difference",
        )),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("season_id", "team_id", "group_name", name="uq_standing_team"),
    )


def downgrade():
    op.drop_table("standing")
    op.drop_table("collection_state")
    for table in ("competition", "stadium", "team", "player", "match", "event"):
        op.drop_constraint(f"uq_{table}_source_external", table, type_="unique")
    # Do not replace unknown scores with zero or remove enum values in use.
