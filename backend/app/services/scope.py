"""Competições removidas do projeto.

O Brasileirão Série A (``BSA``) foi retirado: os dados são escassos e difíceis de
coletar. O escopo do ScoutVision cobre apenas as 5 ligas nacionais (PL, PD, BL1, SA,
FL1). Esta lista é a única fonte da verdade: a coleta ignora esses códigos, as
listagens da API escondem as partidas e ``purge_competition`` apaga o que já estiver
no banco. Champions e FIFA são apenas ocultadas, sem apagar seus dados.
"""
from __future__ import annotations

from sqlalchemy import func, or_, select

from app.db.models import Competition, Season

EXCLUDED_COMPETITION_CODES = frozenset({"BSA"})
HIDDEN_COMPETITION_CODES = EXCLUDED_COMPETITION_CODES | {"CL"}


def hidden_competition():
    """Competições ocultas das listagens, sem alterar a regra de exclusão do banco."""
    return or_(
        func.coalesce(Competition.code, "").in_(HIDDEN_COMPETITION_CODES),
        func.coalesce(Competition.name, "").ilike("%fifa%"),
        func.coalesce(Competition.name, "").ilike("%champions league%"),
    )


def excluded_season_ids():
    """Subconsulta com os ids das temporadas de competições removidas."""
    return (
        select(Season.id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(hidden_competition())
    )
