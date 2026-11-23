"""Competições removidas do projeto.

O Brasileirão Série A (``BSA``) foi retirado: os dados são escassos e difíceis de
coletar. O escopo do ScoutVision cobre as 5 ligas nacionais (PL, PD, BL1, SA,
FL1). ``purge_competition`` apaga apenas os códigos excluídos. Champions, FIFA
e competições PitchAPI fora das cinco ligas são ocultadas sem apagar seus dados.
"""
from __future__ import annotations

from sqlalchemy import and_, func, or_, select

from app.db.models import Competition, DataSource, Season

EXCLUDED_COMPETITION_CODES = frozenset({"BSA"})
HIDDEN_COMPETITION_CODES = EXCLUDED_COMPETITION_CODES | {"CL"}
TOP_FIVE_CODES = ("PL", "PD", "BL1", "SA", "FL1")


def hidden_competition():
    """Competições ocultas das listagens, sem alterar a regra de exclusão do banco."""
    return or_(
        func.coalesce(Competition.code, "").in_(HIDDEN_COMPETITION_CODES),
        func.coalesce(Competition.name, "").ilike("%fifa%"),
        func.coalesce(Competition.name, "").ilike("%champions league%"),
        and_(
            Competition.data_source == DataSource.PITCH_API,
            func.coalesce(Competition.code, "").notin_(TOP_FIVE_CODES),
        ),
    )


def excluded_season_ids():
    """Subconsulta com os ids das temporadas de competições removidas."""
    return (
        select(Season.id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(hidden_competition())
    )
