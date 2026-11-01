"""Competições removidas do projeto.

O Brasileirão Série A (``BSA``) foi retirado: os dados são escassos e difíceis de
coletar. A UEFA Champions League (``CL``) também está fora do escopo do ScoutVision, que
cobre só as 5 ligas nacionais (PL, PD, BL1, SA, FL1). Esta lista é a única fonte da
verdade: a coleta ignora esses códigos, as listagens da API escondem as partidas e
``purge_competition`` apaga o que já estiver no banco.
"""
from __future__ import annotations

from sqlalchemy import select

from app.db.models import Competition, Season

EXCLUDED_COMPETITION_CODES = frozenset({"BSA", "CL"})


def excluded_season_ids():
    """Subconsulta com os ids das temporadas de competições removidas."""
    return (
        select(Season.id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(Competition.code.in_(EXCLUDED_COMPETITION_CODES))
    )
