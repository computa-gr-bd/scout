"""add understat to datasource enum

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Adiciona o valor "understat" ao ENUM datasource de forma idempotente
    # (mesmo padrão de 0002_collection.py para "football_data").
    op.execute("ALTER TYPE datasource ADD VALUE IF NOT EXISTS 'understat'")


def downgrade() -> None:
    # PostgreSQL não suporta remover valores de ENUM diretamente.
    # Para reverter completamente, seria necessário recriar o tipo.
    pass
