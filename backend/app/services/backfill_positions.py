"""Preenche ``Player.position`` dos jogadores sem posição (o "tipo" que aparece na lista).

Fontes, em ordem de confiança:

1. ``PlayerStatistics.recent_form["position"]`` — posição que o Understat já trouxe ("D S", "F M S", "GK");
2. posição mais frequente nas escalações (``Lineup``/``PlayerMatchStatistics``: "GK", "CB", "RW", "DF"...);
3. evidência de goleiro nas estatísticas (defesas/chutes sofridos derivados ou do FBref).

Nunca sobrescreve uma posição já preenchida. Idempotente:

    python -m app.services.backfill_positions            # aplica
    python -m app.services.backfill_positions --dry-run  # só mostra o que faria
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Mapping, Optional

from app.services.position_index import classify_role

# Rótulo curto guardado quando a posição vem das escalações (agrupa CB/LB/RB... em "DF").
ROLE_TO_LABEL = {"GK": "GK", "DEF": "DF", "MID": "MF", "ATT": "FW"}


def pick_position(
    understat_position: Optional[str],
    lineup_positions: Iterable[Optional[str]] = (),
    has_goalkeeper_stats: bool = False,
) -> Optional[str]:
    """Posição a gravar, ou ``None`` se nada for reconhecível. Função pura."""
    if understat_position and classify_role(understat_position):
        return understat_position.strip()[:32]
    roles = Counter(r for r in (classify_role(p) for p in lineup_positions) if r)
    if roles:
        # Quem jogou ao menos uma vez de goleiro e a maioria das vezes lá é goleiro; senão a função mais comum.
        return ROLE_TO_LABEL[roles.most_common(1)[0][0]]
    if has_goalkeeper_stats:
        return "GK"
    return None


def backfill(db: Any, dry_run: bool = False) -> Dict[str, int]:
    from sqlalchemy import select

    from app.db.models import Lineup, Player, PlayerMatchStatistics, PlayerStatistics

    missing = {
        pid: name for pid, name in db.execute(
            select(Player.id, Player.display_name).where((Player.position.is_(None)) | (Player.position == ""))
        ).all()
    }
    summary = {"players_without_position": len(missing), "filled_from_understat": 0,
               "filled_from_lineups": 0, "filled_from_gk_stats": 0, "still_unknown": 0}
    if not missing:
        return summary

    understat_pos: Dict[int, str] = {}
    gk_evidence: set[int] = set()
    for pid, rf, supplemental in db.execute(
        select(PlayerStatistics.player_id, PlayerStatistics.recent_form, PlayerStatistics.supplemental_stats)
        .where(PlayerStatistics.scope == "overall", PlayerStatistics.player_id.in_(list(missing)))
    ).all():
        if isinstance(rf, Mapping) and rf.get("position") and pid not in understat_pos:
            understat_pos[pid] = str(rf["position"])
        if isinstance(supplemental, Mapping):
            derived = supplemental.get("derived") or {}
            provider = supplemental.get("soccerdata") or {}
            if (derived.get("gk_matches") or 0) > 0 or (provider.get("gk_sota") or 0) > 0:
                gk_evidence.add(pid)

    lineup_positions: Dict[int, List[Optional[str]]] = defaultdict(list)
    for model in (Lineup, PlayerMatchStatistics):
        for pid, position in db.execute(
            select(model.player_id, model.position).where(model.player_id.in_(list(missing)), model.position.isnot(None))
        ).all():
            lineup_positions[pid].append(position)

    for pid in missing:
        us = understat_pos.get(pid)
        chosen = pick_position(us, lineup_positions.get(pid, ()), pid in gk_evidence)
        if chosen is None:
            summary["still_unknown"] += 1
            continue
        if us and classify_role(us):
            summary["filled_from_understat"] += 1
        elif lineup_positions.get(pid) and any(classify_role(p) for p in lineup_positions[pid]):
            summary["filled_from_lineups"] += 1
        else:
            summary["filled_from_gk_stats"] += 1
        if not dry_run:
            db.execute(Player.__table__.update().where(Player.id == pid).values(position=chosen))
    return summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Preenche a posição dos jogadores sem posição.")
    parser.add_argument("--dry-run", action="store_true", help="Mostra os totais sem gravar.")
    args = parser.parse_args(argv)
    from app.db import SessionLocal

    with SessionLocal.begin() as db:
        summary = backfill(db, dry_run=args.dry_run)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
