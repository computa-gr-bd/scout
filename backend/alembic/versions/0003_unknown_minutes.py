"""Preserve unknown playing time instead of recording zero minutes."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("lineup", "minutes_played", existing_type=sa.Integer(),
                    nullable=True, server_default=None)


def downgrade():
    # Unknown values must be reconciled by the operator before enforcing NOT NULL.
    op.alter_column("lineup", "minutes_played", existing_type=sa.Integer(),
                    nullable=False, server_default="0")
