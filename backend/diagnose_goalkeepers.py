"""Diagnóstico: por que o goleiro de um time não aparece no provável XI?

    python diagnose_goalkeepers.py --team 1344
    python diagnose_goalkeepers.py --match 123      # os dois times da partida

Mostra, por time, quem o provável XI escolheu no gol e as evidências de goleiro que o
banco tem (escalações "G", defesas por partida, derivados). Não altera nada.
"""
import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.db.models import Match, Player, Team
from app.services.lineups import _goalkeeper_evidence, _line_of, _stats_by_player, estimated_lineup


def report(db, team_id: int) -> None:
    team = db.get(Team, team_id)
    squad = db.scalars(select(Player).where(Player.team_id == team_id)).all()
    stats = _stats_by_player(db, [p.id for p in squad])
    ev = _goalkeeper_evidence(db, team_id, [p.id for p in squad])
    print(f"\n=== {team.name if team else team_id} (id {team_id}) — {len(squad)} jogadores no elenco ===")
    print("Evidência de goleiro (jogador: pontos):")
    for pid, pts in sorted(ev.items(), key=lambda kv: -kv[1]):
        p = db.get(Player, pid)
        in_squad = "no elenco" if pid in {x.id for x in squad} else "FORA do elenco (player.team_id diferente)"
        print(f"  {p.display_name if p else pid}: {pts}  [{in_squad}]  position={p.position if p else None!r}")
    if not ev:
        print("  (nenhuma) -> o banco não tem escalação 'G', defesas nem derivados para este time.")
    gk_by_pos = [p for p in squad if _line_of(p.position) == "GK" or _line_of(stats.get(p.id, {}).get("position")) == "GK"]
    print("Goleiros pela posição cadastrada:", [p.display_name for p in gk_by_pos] or "nenhum")
    xi = estimated_lineup(db, team_id)
    gk = [e["player_name"] for e in xi if e["line"] == "GK"]
    print(f"Provável XI: {len(xi)} jogadores | goleiro escolhido: {gk or 'NENHUM'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", type=int)
    ap.add_argument("--match", type=int)
    a = ap.parse_args()
    with SessionLocal() as db:
        if a.match:
            m = db.get(Match, a.match)
            for tid in (m.home_team_id, m.away_team_id):
                report(db, tid)
        elif a.team:
            report(db, a.team)
        else:
            ap.error("informe --team ou --match")
