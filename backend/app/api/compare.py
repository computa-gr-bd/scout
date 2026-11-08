"""Comparação de jogadores (índices da tela do jogador) e busca de substitutos semelhantes."""
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.player_compare import MAX_PLAYERS, build_comparison, find_similar

router = APIRouter(tags=["compare"], prefix="/compare")


def _parse_entries(raw: str) -> List[Tuple[int, Optional[int]]]:
    """``"12:5,40"`` → ``[(12, 5), (40, None)]`` (jogador[:temporada])."""
    out: List[Tuple[int, Optional[int]]] = []
    for part in (p.strip() for p in raw.split(",") if p.strip()):
        pid, _, sid = part.partition(":")
        try:
            out.append((int(pid), int(sid) if sid else None))
        except ValueError:
            raise HTTPException(400, f"Entrada inválida: '{part}'. Use id ou id:temporada.")
    if not out:
        raise HTTPException(400, "Informe ao menos um jogador em 'entries'.")
    if len(out) > MAX_PLAYERS:
        raise HTTPException(400, f"No máximo {MAX_PLAYERS} jogadores por comparação.")
    return out


@router.get("/players")
def compare_players(
    entries: str = Query(..., description="Jogadores separados por vírgula: id ou id:temporada"),
    template: str = Query("auto", description="auto | ATT | MID | DEF | GK (ATT e MID usam o índice ofensivo)"),
    db: Session = Depends(get_db),
):
    """Compara até 4 jogadores da mesma função com os índices da tela do jogador (ofensivo, defensivo, goleiro)."""
    try:
        return build_comparison(db, _parse_entries(entries), template=template)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/similar")
def similar_players(
    player_id: int,
    season_id: Optional[int] = None,
    scope: str = Query("top5", pattern="^(league|top5)$"),
    league: Optional[str] = Query(None, description="Restringe os candidatos a uma liga (PL, PD, BL1, SA, FL1)"),
    max_age: Optional[int] = Query(None, ge=15, le=45, description="Idade máxima do candidato (útil para 'potencial')"),
    limit: int = Query(8, ge=1, le=20),
    db: Session = Depends(get_db),
):
    """Jogadores da mesma função com perfil mais parecido nos componentes do índice (ofensivo, defensivo, goleiro)."""
    return find_similar(db, player_id, season_id=season_id, scope=scope, league=league, limit=limit, max_age=max_age)
