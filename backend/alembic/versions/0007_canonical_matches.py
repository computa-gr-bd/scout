"""add canonical match references

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("match", sa.Column("canonical_match_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_match_canonical_match_id_match",
        "match",
        "match",
        ["canonical_match_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_match_canonical_match_id",
        "match",
        ["canonical_match_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_match_canonical_match_id", table_name="match")
    op.drop_constraint("fk_match_canonical_match_id_match", "match", type_="foreignkey")
    op.drop_column("match", "canonical_match_id")
