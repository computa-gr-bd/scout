"""Estatísticas de goleiro e de defesa DERIVADAS dos dados que o projeto já tem.

Por que existe
--------------
Em 20/01/2026 a Opta encerrou o contrato com o FBref e o site retirou as estatísticas avançadas
(progressivos, posse, PSxG, desarmes/cortes detalhados...). O Understat nunca teve defesa nem
goleiro. Para continuar tendo nota de goleiro e de defensor, calculamos o que dá a partir de:

* **chutes do Understat** (``Event``/``Shot``: xG, no alvo, gol) — o que cada time SOFREU em cada jogo;
* **escalações / minutos** (``Lineup`` e ``PlayerMatchStatistics``) — quem estava em campo;
* **placar** da partida (gols sofridos exatos, inclusive contra).

O resultado é gravado em ``PlayerStatistics.supplemental_stats["derived"]`` (JSON, sem migration):

Goleiro (só jogos em que atuou ≥ 60 min — o jogo inteiro é atribuído a ele):
    ``gk_matches, gk_minutes, gk_sota, gk_saves, gk_ga, gk_xgot, gk_clean_sheets``
    ``gk_xgot`` = soma do xG dos chutes no alvo sofridos (aproxima o PSxG): ``xgot − ga`` = gols evitados.

Jogador de linha ("em campo", ponderado pelos minutos):
    ``onp_90s, onp_xga, onp_ga, onp_shots_against, onp_sot_against``
    = o que o time sofreu enquanto ele jogava. É um indicador COLETIVO (um zagueiro de time forte
    parece melhor); por isso entra com peso moderado e comparado a pares da mesma liga.

Rode: ``python -m app.services.derived_stats`` (idempotente; recalcula tudo da temporada).
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from app.services.position_index import classify_role

MIN_GK_MINUTES = 60.0
MIN_ONPITCH_MINUTES = 20.0
INT_KEYS = frozenset({"gk_matches", "gk_minutes", "gk_sota", "gk_saves", "gk_ga", "gk_clean_sheets"})
DEFAULT_XG = 0.08           # chute sem xG (mesmo valor usado em shot_insights)


@dataclass
class Participation:
    """Um jogador numa partida, com o que o time dele sofreu naquele jogo."""
    player_id: int
    season_id: Optional[int]
    role: Optional[str]                  # GK / DEF / MID / ATT / None (da posição naquele jogo ou do jogador)
    minutes: Optional[float]
    is_starter: bool = False
    xga: float = 0.0
    shots_against: int = 0
    sot_against: int = 0
    xgot_against: float = 0.0
    goals_from_shots_against: int = 0
    goals_against: Optional[int] = None  # do placar (inclui gols contra); None = sem placar


def effective_minutes(p: Participation) -> Optional[float]:
    """Minutos conhecidos; goleiro titular sem minutos registrados conta como jogo inteiro."""
    if p.minutes:
        return float(p.minutes)
    if p.role == "GK" and p.is_starter:
        return 90.0
    return None


def build_derived(parts: Iterable[Participation]) -> Dict[Tuple[int, Optional[int]], Dict[str, float]]:
    """Agrega participações em ``{(jogador, temporada): valores}``. Função pura."""
    out: Dict[Tuple[int, Optional[int]], Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for p in parts:
        minutes = effective_minutes(p)
        if minutes is None:
            continue
        slot = out[(p.player_id, p.season_id)]
        if p.role == "GK":
            if minutes >= MIN_GK_MINUTES:
                saves = max(0, p.sot_against - p.goals_from_shots_against)
                slot["gk_matches"] += 1
                slot["gk_minutes"] += 90.0
                slot["gk_sota"] += p.sot_against
                slot["gk_saves"] += saves
                slot["gk_xgot"] += p.xgot_against
                if p.goals_against is not None:
                    slot["gk_ga"] += p.goals_against
                    slot["gk_clean_sheets"] += 1 if p.goals_against == 0 else 0
                else:  # sem placar: usa os gols vindos de chute
                    slot["gk_ga"] += p.goals_from_shots_against
                    slot["gk_clean_sheets"] += 1 if p.goals_from_shots_against == 0 else 0
            continue
        if minutes >= MIN_ONPITCH_MINUTES:
            w = min(minutes, 90.0) / 90.0
            slot["onp_90s"] += w
            slot["onp_xga"] += p.xga * w
            slot["onp_shots_against"] += p.shots_against * w
            slot["onp_sot_against"] += p.sot_against * w
            ga = p.goals_against if p.goals_against is not None else p.goals_from_shots_against
            slot["onp_ga"] += ga * w
    result: Dict[Tuple[int, Optional[int]], Dict[str, float]] = {}
    for key, vals in out.items():
        if not vals:
            continue
        result[key] = {k: (int(round(v)) if k in INT_KEYS else round(float(v), 3)) for k, v in vals.items()}
    return result


# --------------------------------------------------------------------------- banco
def _shot_facts(db: Any) -> Dict[Tuple[int, int], Dict[str, float]]:
    """``{(match_id, team_id): {shots, xg, sot, xgot, goals}}`` dos chutes que o TIME fez."""
    from sqlalchemy import select

    from app.db.models import Event, EventType, Shot

    facts: Dict[Tuple[int, int], Dict[str, float]] = defaultdict(
        lambda: {"shots": 0, "xg": 0.0, "sot": 0, "xgot": 0.0, "goals": 0}
    )
    rows = db.execute(
        select(Event.match_id, Event.team_id, Shot.xg, Shot.on_target, Shot.is_goal, Event.outcome)
        .select_from(Event).join(Shot, Shot.event_id == Event.id)
        .where(Event.type == EventType.SHOT)
    ).all()
    for match_id, team_id, xg, on_target, is_goal, outcome in rows:
        goal = bool(is_goal) or (outcome or "").lower() == "goal"
        value = float(xg) if xg is not None else DEFAULT_XG
        f = facts[(match_id, team_id)]
        f["shots"] += 1
        f["xg"] += value
        if on_target or goal:
            f["sot"] += 1
            f["xgot"] += value
        if goal:
            f["goals"] += 1
    return facts


def collect_participations(db: Any, season_id: Optional[int] = None) -> List[Participation]:
    from sqlalchemy import select

    from app.db.models import Lineup, Match, Player, PlayerMatchStatistics, PlayerStatistics

    facts = _shot_facts(db)
    shot_matches = {mid for mid, _ in facts}
    if not shot_matches:
        return []

    match_rows = db.execute(
        select(Match.id, Match.canonical_match_id, Match.home_team_id, Match.away_team_id,
               Match.home_score, Match.away_score, Match.season_id, Match.status)
    ).all()
    info = {r[0]: r for r in match_rows}
    # família: cada partida (clone football-data / espn...) aponta para a partida com chutes
    family_of: Dict[int, int] = {}
    for mid, canonical, *_ in match_rows:
        if mid in shot_matches:
            family_of[mid] = mid
        elif canonical in shot_matches:
            family_of[mid] = canonical
    base_ids = {mid: info[mid] for mid in shot_matches if mid in info and info[mid][7] == "finished"
                and (season_id is None or info[mid][6] == season_id)}
    if not base_ids:
        return []

    # papel do jogador: posição cadastrada, senão a posição do Understat guardada em recent_form
    player_pos: Dict[int, Optional[str]] = {pid: pos for pid, pos in db.execute(select(Player.id, Player.position)).all()}
    for pid, rf in db.execute(
        select(PlayerStatistics.player_id, PlayerStatistics.recent_form)
        .where(PlayerStatistics.scope == "overall")
    ).all():
        if not player_pos.get(pid) and isinstance(rf, dict) and rf.get("position"):
            player_pos[pid] = str(rf["position"])

    rows: Dict[Tuple[int, int], Tuple[Optional[float], bool, Optional[str], int]] = {}
    family_ids = [mid for mid, base in family_of.items() if base in base_ids]
    for mid, team_id, pid, starter, pos, minutes in db.execute(
        select(Lineup.match_id, Lineup.team_id, Lineup.player_id, Lineup.is_starter, Lineup.position, Lineup.minutes_played)
        .where(Lineup.match_id.in_(family_ids))
    ).all():
        rows[(mid, pid)] = (minutes, bool(starter), pos, team_id)
    for mid, team_id, pid, starter, pos, minutes in db.execute(
        select(PlayerMatchStatistics.match_id, PlayerMatchStatistics.team_id, PlayerMatchStatistics.player_id,
               PlayerMatchStatistics.is_starter, PlayerMatchStatistics.position, PlayerMatchStatistics.minutes_played)
        .where(PlayerMatchStatistics.match_id.in_(family_ids))
    ).all():
        prev = rows.get((mid, pid))
        if prev is None or (not prev[0] and minutes):
            rows[(mid, pid)] = (minutes, bool(starter) or (prev[1] if prev else False), pos or (prev[2] if prev else None), team_id)

    parts: List[Participation] = []
    seen: set[Tuple[int, int]] = set()   # (partida-base, jogador): o mesmo jogo em dois clones conta uma vez
    for (mid, pid), (minutes, starter, pos, team_id) in rows.items():
        base_id = family_of[mid]
        if (base_id, pid) in seen:
            continue
        base = base_ids[base_id]
        own = info.get(mid, base)
        is_home = team_id == own[2]
        if team_id not in (own[2], own[3]):
            continue
        seen.add((base_id, pid))
        opp_team = base[3] if is_home else base[2]
        f = facts.get((base_id, opp_team), {"shots": 0, "xg": 0.0, "sot": 0, "xgot": 0.0, "goals": 0})
        goals_against = base[5] if is_home else base[4]
        role = classify_role(pos) if classify_role(pos) == "GK" else (classify_role(player_pos.get(pid)) or classify_role(pos))
        parts.append(Participation(
            player_id=pid, season_id=base[6], role=role, minutes=float(minutes) if minutes else None,
            is_starter=starter, xga=f["xg"], shots_against=int(f["shots"]), sot_against=int(f["sot"]),
            xgot_against=f["xgot"], goals_from_shots_against=int(f["goals"]), goals_against=goals_against,
        ))
    return parts


def compute_and_store(db: Any, season_id: Optional[int] = None) -> Dict[str, int]:
    """Recalcula e grava ``supplemental_stats["derived"]``. Só atualiza linhas que já existem."""
    from sqlalchemy import select

    from app.db.models import PlayerStatistics

    parts = collect_participations(db, season_id)
    derived = build_derived(parts)
    updated = missing = 0
    for (pid, sid), values in derived.items():
        stat = db.scalar(select(PlayerStatistics).where(
            PlayerStatistics.player_id == pid, PlayerStatistics.season_id == sid,
            PlayerStatistics.scope == "overall"))
        if stat is None:
            missing += 1
            continue
        supplemental = dict(stat.supplemental_stats) if isinstance(stat.supplemental_stats, dict) else {}
        supplemental["derived"] = values
        stat.supplemental_stats = supplemental
        updated += 1
    db.flush()
    gks = sum(1 for v in derived.values() if v.get("gk_matches"))
    return {"participations": len(parts), "players_updated": updated, "players_without_stats_row": missing,
            "goalkeepers": gks}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Calcula estatísticas derivadas de goleiro e defesa (chutes + escalações).")
    parser.add_argument("--season-id", type=int, default=None, help="Limita a uma temporada (id interno).")
    args = parser.parse_args(argv)
    from app.db import SessionLocal

    with SessionLocal.begin() as db:
        summary = compute_and_store(db, args.season_id)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
