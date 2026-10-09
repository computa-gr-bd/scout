"""Link players to their current club (squad from football-data)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _player_columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("player")}


def _player_fk_names() -> set:
    return {fk["name"] for fk in inspect(op.get_bind()).get_foreign_keys("player")}


def _player_index_names() -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes("player")}


def upgrade():
    # Idempotente: uma execução anterior pode ter aplicado o DDL e falhado
    # antes de gravar o alembic_version (container reiniciando no meio).
    # Sem essa checagem o restart trava em crash loop com DuplicateColumn.
    columns = _player_columns()
    if "team_id" not in columns:
        op.add_column("player", sa.Column("team_id", sa.Integer(), nullable=True))
    if "fk_player_team_id" not in _player_fk_names():
        op.create_foreign_key("fk_player_team_id", "player", "team", ["team_id"], ["id"],
                              ondelete="SET NULL")
    if "ix_player_team_id" not in _player_index_names():
        op.create_index(op.f("ix_player_team_id"), "player", ["team_id"], unique=False)


def downgrade():
    if "ix_player_team_id" in _player_index_names():
        op.drop_index(op.f("ix_player_team_id"), table_name="player")
    if "fk_player_team_id" in _player_fk_names():
        op.drop_constraint("fk_player_team_id", "player", type_="foreignkey")
    if "team_id" in _player_columns():
        op.drop_column("player", "team_id")