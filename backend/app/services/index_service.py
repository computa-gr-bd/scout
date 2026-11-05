"""Leitura do banco para os índices por função (defensor / goleiro) e para a análise de partidas.

A matemática fica em ``position_index.py`` (pura e testável). Aqui só buscamos:

* as estatísticas da temporada mais recente do jogador (colunas + totais do FBref);
* os "pares" (mesma função, mesma liga, mesma temporada) para calcular percentis;
* o goleiro titular de um time (usado nas zonas defensivas e nas probabilidades de gol);
* os minutos jogados por partida (usados nas probabilidades por jogador).
"""
from __future__ import annotations

import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Lineup, Match, Player, PlayerMatchStatistics, PlayerStatistics, Season, TeamMatchStatistics,
)
from app.services.player_profile import LEAGUE_LABELS, team_league_map
from app.services.position_index import (
    COMPONENTS, LEAGUE_SAVE_PCT, ROLE_LABELS, aggregate_match_rows, apply_match_totals, compute_metrics, flatten_stat,
    gk_goal_factor, gk_totals, infer_role, reduce_peer_metrics, score_index,
)

PEER_MIN_MINUTES = 450
_PEER_CACHE: Dict[Tuple[str, Optional[int], Optional[str]], Tuple[float, List[Dict[str, Any]]]] = {}
_PEER_TTL = 600.0


def clear_peer_cache() -> None:
    _PEER_CACHE.clear()


def stat_columns(stat: PlayerStatistics) -> Dict[str, Any]:
    return {c: getattr(stat, c, None) for c in (
        "matches_played", "minutes_played", "starts", "goals", "assists", "tackles", "interceptions",
        "clearances", "aerials_won", "aerials_lost", "passes", "passes_completed", "key_passes",
        "fouls_committed", "crosses",
    )}


def stat_flat(stat: Optional[PlayerStatistics],
              match_totals: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """``flat`` da temporada; ``match_totals`` (somas das partidas no banco) só completa o que falta."""
    if stat is None:
        return {}
    flat = flatten_stat(
        stat_columns(stat),
        stat.supplemental_stats if isinstance(stat.supplemental_stats, dict) else None,
        stat.recent_form if isinstance(stat.recent_form, dict) else None,
    )
    return apply_match_totals(flat, match_totals)


def _espn_raw(supplemental: Any, key: str) -> float:
    espn = supplemental.get("espn") if isinstance(supplemental, dict) else None
    raw = espn.get("raw") if isinstance(espn, dict) else None
    try:
        return float(raw.get(key) or 0) if isinstance(raw, dict) else 0.0
    except (TypeError, ValueError):
        return 0.0


def match_totals_for(db: Session, player_ids: Sequence[int],
                     season_id: Optional[int]) -> Dict[int, Dict[str, float]]:
    """``{jogador: somas}`` das partidas da temporada gravadas em ``PlayerMatchStatistics``.

    Traz do banco o que o JSON do FBref não trouxe: defesas/gols sofridos/chutes enfrentados do
    goleiro, faltas, cartões, passes, desarmes e interceptações (quando a fonte tem) e o que o time
    sofreu com o jogador em campo (placar, xG e chutes do adversário). Só partidas "canônicas"
    (sem clones de outras fontes). A temporada é casada por ``season_id`` OU pela janela de datas.
    """
    ids = sorted({int(i) for i in player_ids if i is not None})
    if not ids:
        return {}
    stmt = (
        select(PlayerMatchStatistics, Match)
        .join(Match, Match.id == PlayerMatchStatistics.match_id)
        .where(PlayerMatchStatistics.player_id.in_(ids), Match.canonical_match_id.is_(None))
    )
    season = db.get(Season, season_id) if season_id is not None else None
    if season is not None:
        in_season = [Match.season_id == season.id]
        if season.start_date and season.end_date:
            in_season.append(and_(Match.kickoff_time >= season.start_date,
                                  Match.kickoff_time <= season.end_date))
        stmt = stmt.where(or_(*in_season))
    pairs = db.execute(stmt).all()
    if not pairs:
        return {}

    team_rows: Dict[Tuple[int, int], TeamMatchStatistics] = {}
    match_ids = {m.id for _, m in pairs}
    for tms in db.scalars(select(TeamMatchStatistics).where(TeamMatchStatistics.match_id.in_(match_ids))).all():
        team_rows[(tms.match_id, tms.team_id)] = tms

    by_player: Dict[int, List[Dict[str, Any]]] = {}
    for pms, match in pairs:
        is_home = pms.team_id == match.home_team_id
        opp_id = match.away_team_id if is_home else match.home_team_id
        scored_against = match.away_score if is_home else match.home_score
        own, opp = team_rows.get((match.id, pms.team_id)), team_rows.get((match.id, opp_id))
        finished = (match.status or "").lower() == "finished"
        by_player.setdefault(pms.player_id, []).append({
            "minutes": pms.minutes_played, "is_starter": pms.is_starter, "position": pms.position,
            "tackles": pms.tackles, "interceptions": pms.interceptions,
            "fouls_committed": pms.fouls_committed, "fouls_suffered": pms.fouls_suffered,
            "passes": pms.passes, "passes_completed": pms.passes_completed, "key_passes": pms.key_passes,
            "duels": pms.duels, "duels_won": pms.duels_won,
            "yellow": _espn_raw(pms.supplemental_stats, "yellowCards"),
            "red": _espn_raw(pms.supplemental_stats, "redCards"),
            "saves": pms.saves, "goals_conceded": pms.goals_conceded, "shots_faced": pms.shots_faced,
            "team_ga": scored_against if finished else None,
            "team_xga": own.xga if own is not None else None,
            "opp_shots": opp.shots if opp is not None else None,
        })
    return {pid: aggregate_match_rows(rows) for pid, rows in by_player.items()}


def role_of(position: Optional[str], stat: Optional[PlayerStatistics], flat: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Função do jogador: ``Player.position`` → posição do Understat (``recent_form``) → estatísticas.

    O Understat guarda a posição em ``PlayerStatistics.recent_form["position"]``; muitos jogadores
    têm ``Player.position`` vazio, então só olhar a coluna deixava o jogador sem "tipo".
    """
    rf = stat.recent_form if stat is not None and isinstance(stat.recent_form, dict) else {}
    return infer_role(position, rf.get("position"), flat=flat if flat is not None else stat_flat(stat))


def latest_overall(db: Session, player_id: int) -> Optional[PlayerStatistics]:
    """Estatística "overall" mais recente que tenha minutos (senão a mais recente qualquer)."""
    rows = list(db.scalars(
        select(PlayerStatistics)
        .where(PlayerStatistics.player_id == player_id, PlayerStatistics.scope == "overall")
        .order_by(PlayerStatistics.season_id.desc().nullslast())
    ).all())
    return next((r for r in rows if (r.minutes_played or 0) > 0), rows[0] if rows else None)


# --------------------------------------------------------------------------- pares da liga
def league_peers(db: Session, role: str, season_id: Optional[int], league_code: Optional[str],
                 league_map: Optional[Dict[int, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """``flat`` de cada jogador da mesma função/liga/temporada (com ``player_id``), em cache curto."""
    key = (role, season_id, league_code)
    hit = _PEER_CACHE.get(key)
    if hit and time.time() - hit[0] < _PEER_TTL:
        return hit[1]
    league_map = league_map if league_map is not None else team_league_map(db)
    team_ids = [tid for tid, info in league_map.items() if not league_code or info["code"] == league_code]
    peers: List[Dict[str, Any]] = []
    if team_ids:
        stmt = (
            select(PlayerStatistics, Player.position, Player.id)
            .join(Player, Player.id == PlayerStatistics.player_id)
            .where(
                Player.team_id.in_(team_ids),
                PlayerStatistics.scope == "overall",
                PlayerStatistics.minutes_played >= PEER_MIN_MINUTES,
            )
        )
        if season_id is not None:
            stmt = stmt.where(PlayerStatistics.season_id == season_id)
        seen: set[int] = set()
        rows = db.execute(stmt).all()
        totals = match_totals_for(db, [pid for _, _, pid in rows], season_id)
        for stat, position, player_id in rows:
            if player_id in seen:
                continue
            flat = stat_flat(stat, totals.get(player_id))
            if role_of(position, stat, flat) != role:
                continue
            seen.add(player_id)
            peers.append({"player_id": player_id, **flat})
    _PEER_CACHE[key] = (time.time(), peers)
    return peers


def league_save_pct(peers: Iterable[Dict[str, Any]]) -> float:
    saves = sota = 0.0
    for flat in peers:
        gk = gk_totals(flat)
        if gk and gk.get("sota"):
            saves += float(gk.get("saves") or 0)
            sota += float(gk["sota"])
    return saves / sota if sota >= 150 else LEAGUE_SAVE_PCT


# --------------------------------------------------------------------------- KPIs de cada função
def _kpi(key: str, label: str, value: Optional[float], unit: str = "", decimals: int = 2,
         sub: Optional[str] = None, league_avg: Optional[float] = None) -> Dict[str, Any]:
    return {
        "key": key, "label": label, "unit": unit, "sub": sub,
        "value": None if value is None else round(value, decimals),
        "league_avg": None if league_avg is None else round(league_avg, decimals),
    }


def _avg(peer_metrics: Sequence[Dict[str, Optional[float]]], key: str) -> Optional[float]:
    values = [p[key] for p in peer_metrics if p.get(key) is not None]
    return sum(values) / len(values) if values else None


def build_kpis(role: str, flat: Dict[str, Any], m: Dict[str, Optional[float]],
               peer_metrics: Sequence[Dict[str, Optional[float]]]) -> List[Dict[str, Any]]:
    g = lambda k: flat.get(k)  # noqa: E731
    if role == "GK":
        pk_att, pk_saved = g("gk_pk_att"), g("gk_pk_saved")
        gk = gk_totals(flat) or {}
        return [
            _kpi("save_pct", "Defesas", m.get("save_pct"), "%", 1,
                 sub=f"{int(gk.get('saves') or 0)} em {int(gk.get('sota') or 0)} chutes no alvo",
                 league_avg=_avg(peer_metrics, "save_pct")),
            _kpi("psxg_diff_p90", "Gols evitados / 90", m.get("psxg_diff_p90"), "", 2,
                 sub="PSxG − gols sofridos (positivo = acima do esperado)",
                 league_avg=_avg(peer_metrics, "psxg_diff_p90")),
            _kpi("ga_p90", "Gols sofridos / 90", m.get("ga_p90"), "", 2,
                 sub=f"Total: {int(gk.get('ga') or 0)}", league_avg=_avg(peer_metrics, "ga_p90")),
            _kpi("clean_sheet_pct", "Jogos sem sofrer gol", m.get("clean_sheet_pct"), "%", 0,
                 sub=f"{int(gk.get('cs') or 0)} jogos", league_avg=_avg(peer_metrics, "clean_sheet_pct")),
            _kpi("cross_stop_pct", "Cruzamentos interceptados", m.get("cross_stop_pct"), "%", 1,
                 sub=f"{int(g('gk_crosses_stopped') or 0)} de {int(g('gk_crosses_opp') or 0)}",
                 league_avg=_avg(peer_metrics, "cross_stop_pct")),
            _kpi("opa_p90", "Ações fora da área / 90", m.get("opa_p90"), "", 2,
                 league_avg=_avg(peer_metrics, "opa_p90")),
            _kpi("launched_cmp_pct", "Lançamentos certos", m.get("launched_cmp_pct"), "%", 1,
                 league_avg=_avg(peer_metrics, "launched_cmp_pct")),
            _kpi("pk_save_pct", "Pênaltis defendidos", None if not pk_att else float(pk_saved or 0), "", 0,
                 sub=f"de {int(pk_att)} cobrados" if pk_att else None),
        ]
    if role == "DEF":
        tackle_win_pct = m.get("tackle_win_pct")
        tackles = flat.get("tkl_won")
        if tackles is None:
            tackles = g("tackles")
        tackle_value = tackle_win_pct if tackle_win_pct is not None else tackles
        tackle_unit = "%" if tackle_win_pct is not None else ""
        tackle_sub = (
            None if tackle_win_pct is not None or tackles is None
            else f"{int(tackles)} desarmes ganhos na temporada"
        )
        return [
            _kpi("tkl_int_p90", "Desarmes + interc. / 90", m.get("tkl_int_p90"), "", 2,
                 league_avg=_avg(peer_metrics, "tkl_int_p90")),
            _kpi("tackle_win_pct", "Desarmes ganhos", tackle_value, tackle_unit, 1, sub=tackle_sub,
                 league_avg=_avg(peer_metrics, "tackle_win_pct")),
            _kpi("aerials_won_p90", "Aéreos ganhos / 90", m.get("aerials_won_p90"), "", 2,
                 sub=f"{m['aerial_win_pct']:.0f}% de aproveitamento" if m.get("aerial_win_pct") is not None else None,
                 league_avg=_avg(peer_metrics, "aerials_won_p90")),
            _kpi("clearances_p90", "Cortes / 90", m.get("clearances_p90"), "", 2,
                 league_avg=_avg(peer_metrics, "clearances_p90")),
            _kpi("blocks_p90", "Bloqueios / 90", m.get("blocks_p90"), "", 2,
                 league_avg=_avg(peer_metrics, "blocks_p90")),
            _kpi("prog_passes_p90", "Passes progressivos / 90", m.get("prog_passes_p90"), "", 2,
                 league_avg=_avg(peer_metrics, "prog_passes_p90")),
            _kpi("prog_carries_p90", "Conduções progressivas / 90", m.get("prog_carries_p90"), "", 2,
                 league_avg=_avg(peer_metrics, "prog_carries_p90")),
            _kpi("fouls_p90", "Faltas / 90", m.get("fouls_p90"), "", 2, league_avg=_avg(peer_metrics, "fouls_p90")),
        ]
    return []


def _data_sources(flat: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    if any(k.startswith("us_") for k in flat) or flat.get("key_passes"):
        out.append("Understat (xGBuildup, xGChain, passes-chave, cartões)")
    if any(k.startswith("d_") for k in flat):
        out.append("Derivado dos chutes do Understat + escalações (defesas, gols evitados, defesa em campo)")
    if any(k.startswith(("m_gk_", "m_onp_")) for k in flat):
        out.append("Estatísticas por partida do banco (ESPN: defesas, gols sofridos, faltas, cartões, placar)")
    if any(k in flat for k in (
        "gk_sota", "tkl", "tkl_plus_int", "tackles", "interceptions", "clearances",
        "aerials_won", "aerials_lost", "progressive_passes", "pass_att",
    )):
        out.append("FBref / SoccerData")
    return out


# --------------------------------------------------------------------------- payload do jogador
def player_index_payload(db: Session, player: Player) -> Dict[str, Any]:
    """Índice da função do jogador. MID/ATT continuam usando o índice ofensivo da tela (``role`` indica)."""
    stat = latest_overall(db, player.id)
    role = role_of(player.position, stat)
    base = {"player_id": player.id, "role": role, "role_label": ROLE_LABELS.get(role) if role else None}
    if role not in COMPONENTS:
        return {**base, "available": False, "index": None,
                "reason": "Atacantes e meias usam o índice ofensivo." if role else "Posição do jogador desconhecida."}

    if stat is None or not (stat.minutes_played or 0):
        return {**base, "available": False, "index": None,
                "reason": "Sem minutos registrados para calcular o índice."}

    league_map = team_league_map(db)
    league_code = (league_map.get(player.team_id) or {}).get("code") if player.team_id else None
    flat = stat_flat(stat, match_totals_for(db, [player.id], stat.season_id).get(player.id))
    metrics = compute_metrics(role, flat)
    peers = [p for p in league_peers(db, role, stat.season_id, league_code, league_map) if p["player_id"] != player.id]
    peer_metrics = reduce_peer_metrics(role, peers, PEER_MIN_MINUTES)
    result = score_index(role, metrics, peer_metrics, float(stat.minutes_played or 0))
    return {
        **base, **result,
        "kpis": build_kpis(role, flat, metrics, peer_metrics),
        "sample": {
            "minutes": stat.minutes_played, "matches": stat.matches_played, "season_id": stat.season_id,
            "league": LEAGUE_LABELS.get(league_code, league_code) if league_code else None,
            "peers": len(peer_metrics),
        },
        "data_sources": _data_sources(flat),
        "notes": [
            "Índice 0–100 calculado com Understat, escalações e FBref (quando disponível); não é um modelo treinado.",
            (f"Notas por percentil entre {len(peer_metrics)} {ROLE_LABELS[role].lower()}s da liga com ≥ {PEER_MIN_MINUTES} min."
             if result.get("method") == "percentile"
             else "Poucos pares na liga: notas calculadas contra faixas típicas do futebol europeu."),
        ],
    }


# --------------------------------------------------------------------------- goleiro de um time
def team_goalkeeper(db: Session, team_ids: Sequence[int]) -> Optional[Dict[str, Any]]:
    """Goleiro com mais minutos na temporada mais recente do time, com índice e fator para as previsões."""
    if not team_ids:
        return None
    rows = db.execute(
        select(PlayerStatistics, Player)
        .join(Player, Player.id == PlayerStatistics.player_id)
        .where(Player.team_id.in_(list(team_ids)), PlayerStatistics.scope == "overall",
               PlayerStatistics.minutes_played > 0)
    ).all()
    candidates = []
    for stat, player in rows:
        flat = stat_flat(stat)
        if role_of(player.position, stat, flat) == "GK":
            candidates.append((stat, player, flat))
    if not candidates:
        return None
    candidates.sort(key=lambda sp: (sp[0].season_id or 0, sp[0].minutes_played or 0), reverse=True)
    stat, player, flat = candidates[0]
    flat = stat_flat(stat, match_totals_for(db, [player.id], stat.season_id).get(player.id))
    totals = gk_totals(flat)
    if totals is None:
        # Sem defesas nem chutes derivados (ainda não rodou derived_stats / FBref): nada a comparar.
        return {"player_id": player.id, "name": player.display_name or player.last_name,
                "minutes": stat.minutes_played, "has_data": False, "has_fbref": False,
                "index": None, "goal_factor": None}

    league_map = team_league_map(db)
    league_code = next((league_map[t]["code"] for t in team_ids if t in league_map), None)
    peers = [p for p in league_peers(db, "GK", stat.season_id, league_code, league_map) if p["player_id"] != player.id]
    peer_metrics = reduce_peer_metrics("GK", peers, PEER_MIN_MINUTES)
    metrics = compute_metrics("GK", flat)
    result = score_index("GK", metrics, peer_metrics, float(stat.minutes_played or 0))
    factor = gk_goal_factor(flat, league_save_pct(peers))
    return {
        "player_id": player.id,
        "name": player.display_name or player.last_name,
        "minutes": stat.minutes_played,
        "matches": stat.matches_played,
        "has_data": True,
        "data_source": totals["source"],
        "has_fbref": totals["source"] == "fbref",
        "index": result.get("index"),
        "reliability": result.get("reliability"),
        "components": [{"key": c["key"], "label": c["label"], "score": c["score"]} for c in result.get("components", [])],
        "save_pct": metrics.get("save_pct"),
        "psxg_diff_p90": metrics.get("psxg_diff_p90"),
        "ga_p90": metrics.get("ga_p90"),
        "clean_sheet_pct": metrics.get("clean_sheet_pct"),
        "cross_stop_pct": metrics.get("cross_stop_pct"),
        "goal_factor": factor["factor"] if factor else None,
        "shots_on_target_faced": factor["shots_on_target_faced"] if factor else None,
    }


# --------------------------------------------------------------------------- minutos recentes por partida
def recent_minutes(db: Session, player_ids: Sequence[int], match_ids_desc: Sequence[int],
                   min_known: int = 2) -> Dict[int, List[int]]:
    """``{jogador: [minutos por partida, da mais recente à mais antiga]}`` na janela de jogos do time.

    Partidas sem registro do jogador contam 0 (não entrou). Jogadores com menos de ``min_known``
    partidas com minutos conhecidos ficam de fora — o chamador cai no cálculo por jogos do time.
    """
    if not player_ids or not match_ids_desc:
        return {}
    by_pm: Dict[Tuple[int, int], int] = {}
    for pid, mid, minutes in db.execute(
        select(Lineup.player_id, Lineup.match_id, Lineup.minutes_played)
        .where(Lineup.match_id.in_(list(match_ids_desc)), Lineup.player_id.in_(list(player_ids)))
    ).all():
        if minutes:
            by_pm[(pid, mid)] = max(by_pm.get((pid, mid), 0), int(minutes))
    for pid, mid, minutes in db.execute(
        select(PlayerMatchStatistics.player_id, PlayerMatchStatistics.match_id, PlayerMatchStatistics.minutes_played)
        .where(PlayerMatchStatistics.match_id.in_(list(match_ids_desc)),
               PlayerMatchStatistics.player_id.in_(list(player_ids)))
    ).all():
        if minutes:
            by_pm[(pid, mid)] = max(by_pm.get((pid, mid), 0), int(minutes))

    out: Dict[int, List[int]] = {}
    for pid in player_ids:
        known = sum(1 for mid in match_ids_desc if by_pm.get((pid, mid)))
        if known >= min_known:
            out[pid] = [min(120, by_pm.get((pid, mid), 0)) for mid in match_ids_desc]
    return out


__all__ = [
    "latest_overall", "stat_flat", "clear_peer_cache", "league_peers", "player_index_payload", "team_goalkeeper", "recent_minutes",
]
