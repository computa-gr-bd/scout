"""Apaga do banco as competições removidas do projeto (por padrão, o Brasileirão ``BSA``).

    python -m app.services.purge_competition            # apaga de verdade
    python -m app.services.purge_competition --dry-run  # só mostra o que seria apagado

É idempotente: sem nada para apagar, não faz nada. Remove a competição (e, em cascata,
temporadas, partidas, eventos, estatísticas) e os times da football-data que ficaram
sem nenhuma partida.
"""
from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.db.models import CollectionState, Competition, DataSource, Match, Team
from app.services.scope import EXCLUDED_COMPETITION_CODES


def purge(db: Session, codes=EXCLUDED_COMPETITION_CODES, *, dry_run: bool = False) -> dict:
    codes = sorted({c.upper() for c in codes})
    comps = db.scalars(select(Competition).where(Competition.code.in_(codes))).all()
    summary = {"codes": codes, "competitions": len(comps), "matches": 0, "teams": 0, "dry_run": dry_run}
    for comp in comps:
        for season in comp.seasons:
            summary["matches"] += db.scalar(
                select(func.count()).select_from(Match).where(Match.season_id == season.id)
            ) or 0
    if not dry_run:
        for comp in comps:
            db.delete(comp)  # cascade: temporadas -> partidas -> eventos/estatísticas
        db.flush()
        db.execute(delete(CollectionState).where(
            CollectionState.provider == DataSource.FOOTBALL_DATA.value,
            CollectionState.resource.in_(codes),
        ))

    # Times da football-data que não aparecem em nenhuma partida restante.
    with_matches = select(Match.home_team_id).union(select(Match.away_team_id))
    orphans = db.scalars(
        select(Team).where(Team.data_source == DataSource.FOOTBALL_DATA, Team.id.notin_(with_matches))
    ).all()
    summary["teams"] = len(orphans)
    if not dry_run:
        for team in orphans:
            db.delete(team)
        db.commit()
    return summary


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codes", nargs="+", default=sorted(EXCLUDED_COMPETITION_CODES))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    with SessionLocal() as db:
        print(json.dumps(purge(db, args.codes, dry_run=args.dry_run), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
