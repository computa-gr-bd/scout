"""Análise tática calculada AO VIVO a partir dos chutes reais (Understat).

Alimenta a tela de Análise sem depender de tabelas pré-calculadas (``DefensiveWeakness``,
``PlayerZoneStats``) nem de modelo treinado — que só existem nos dados de demonstração:

* **Zonas fracas** de cada defesa: xG concedido por zona nos últimos jogos do time, comparado
  com a média da liga (mesma temporada). 0,5 = na média; 1,0 = o dobro da média (ou mais).
* **Probabilidades por jogador** (chute, no alvo, gol, participação em gol): taxas recentes do
  jogador (Poisson: P(≥1 evento)) ajustadas pela fraqueza da defesa adversária nas zonas onde ele finaliza.
* **Confrontos**: atacante × defesa adversária, explicando o porquê.

Tudo é estatística transparente (sem caixa-preta) e só usa jogos ANTERIORES à partida
analisada, então não há vazamento do resultado na análise de um jogo já disputado.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from app.db.models import Event, EventType, Lineup, Match, Player, PlayerMatchStatistics, ZONE_ORDER
from app.services.player_dedupe import _name_match
from app.services.index_service import recent_minutes, team_goalkeeper
from app.services.studio import (
    _is_own_goal, _load_shot_events, _player_name, _recent_match_ids, _same_person, _team_ids_like, norm_person,
)

log = logging.getLogger(__name__)

WINDOW = 10            # jogos recentes de cada time
LEAGUE_WINDOW = 120    # jogos da temporada usados como média da liga
PRIOR_MATCHES = 3.0    # "jogos fictícios na média" que suavizam amostras pequenas
TOP_PLAYERS = 10       # jogadores por time na lista de estimativas
RECENCY_HALF_LIFE = 6.0   # jogos: um jogo 6 rodadas atrás pesa metade na defesa
RECENT_FORM_MATCHES = 5   # janela da "tendência" por zona
MINUTES_HALF_LIFE = 5.0   # jogos: peso dos minutos recentes na projeção de minutos
SHRINK_K = 2.0            # "jogos de 90' fictícios" que puxam a taxa do jogador para a média do time
METHOD = "shot-poisson@2"

ZONE_LABEL_PT = {
    "central_box": "área central",
    "outside_box_central": "fora da área (centro)",
    "outside_box_left": "fora da área (esquerda)",
    "outside_box_right": "fora da área (direita)",
    "opp_left_channel": "corredor esquerdo",
    "opp_right_channel": "corredor direito",
    "opp_central_midfield": "meio-campo adversário",
    "opp_left_flank": "ala esquerda",
    "opp_right_flank": "ala direita",
}


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def classify_zone(x: float, y: float) -> str:
    """Zona (mesma divisão da tela) de um ponto 0–100, com o time atacando para x=100."""
    x = clamp(x, 0, 100)
    y = clamp(y, 0, 100)
    if x >= 92 and 29 <= y <= 71:
        return "central_box"
    if x >= 84 and 21 <= y <= 79:
        return "outside_box_left" if y < 40 else ("outside_box_central" if y < 60 else "outside_box_right")
    if x >= 70:
        if y < 18:
            return "opp_left_flank"
        if y < 38:
            return "opp_left_channel"
        if y < 62:
            return "opp_central_midfield"
        if y < 82:
            return "opp_right_channel"
        return "opp_right_flank"
    if x >= 30:
        if y < 18:
            return "neutral_left_flank"
        if y > 82:
            return "neutral_right_flank"
        return "neutral_midfield"
    # campo próprio
    if x < 16 and 21 <= y <= 79:
        return "own_box"
    if y < 18:
        return "own_left_flank"
    if y < 38:
        return "own_left_channel"
    if y < 62:
        return "own_central_midfield"
    if y < 82:
        return "own_right_channel"
    return "own_right_flank"


def _xg(e: Event) -> float:
    shot = e.shot
    return float(shot.xg) if shot is not None and shot.xg is not None else 0.08


def _is_goal(e: Event) -> bool:
    return bool(e.shot and e.shot.is_goal) or (e.outcome or "").lower() == "goal"


def _on_target(e: Event) -> bool:
    return bool(e.shot and e.shot.on_target) or _is_goal(e)


def _own_zone(e: Event) -> Tuple[str, str]:
    """(zona de ataque do chutador, zona própria do defensor) — o defensor vê o campo girado 180°."""
    px, py = e.position.x, e.position.y
    return classify_zone(px, py), classify_zone(100 - px, 100 - py)


def _league_baseline(db: Session, m: Match, fallback_events: List[Event]) -> Tuple[Dict[str, float], Dict[str, float], int]:
    """xG médio por time-jogo em cada zona (ataque / defesa), da própria temporada."""
    return season_baseline(db, m.season_id, m.kickoff_time, fallback_events)


def season_baseline(
    db: Session, season_id: Optional[int], before: datetime, fallback_events: List[Event],
) -> Tuple[Dict[str, float], Dict[str, float], int]:
    """Mesma média da liga, mas para uma temporada e um instante de corte quaisquer."""
    ids: List[int] = []
    if season_id is not None:
        ids = list(db.scalars(
            select(Match.id)
            .where(
                Match.season_id == season_id,
                Match.kickoff_time < before,
                Match.status == "finished",
                Match.id.in_(select(Event.match_id).where(Event.type == EventType.SHOT)),
            )
            .order_by(desc(Match.kickoff_time))
            .limit(LEAGUE_WINDOW)
        ).all())
    events = _load_shot_events(db, ids) if len(ids) >= 6 else fallback_events
    n_matches = len(ids) if len(ids) >= 6 else max(1, len({e.match_id for e in fallback_events}))
    att: Dict[str, float] = defaultdict(float)
    dfn: Dict[str, float] = defaultdict(float)
    for e in events:
        a, d = _own_zone(e)
        att[a] += _xg(e)
        dfn[d] += _xg(e)
    per = 2.0 * n_matches  # dois times por jogo
    return {k: v / per for k, v in att.items()}, {k: v / per for k, v in dfn.items()}, n_matches


def _zone_ratio(total: float, n_matches: int, baseline_per_match: float) -> float:
    """Razão suavizada (1,0 = média da liga)."""
    if baseline_per_match <= 1e-9:
        return 1.0
    return (total + PRIOR_MATCHES * baseline_per_match) / ((n_matches + PRIOR_MATCHES) * baseline_per_match)


def _recency_weight(rank: int) -> float:
    """Peso do jogo ``rank`` (0 = mais recente) na janela — decaimento exponencial."""
    return 0.5 ** (rank / RECENCY_HALF_LIFE)


def _zone_reliability(shots: int, n_matches: int) -> str:
    if n_matches < 4 or shots < 3:
        return "low"
    return "high" if (shots >= 10 and n_matches >= 6) else "medium"


def _defense_profile(events: List[Event], team_ids: set, match_ids: List[int], base_def: Dict[str, float],
                     recency: bool = True) -> List[Dict[str, Any]]:
    """Fraqueza defensiva por zona (zona própria do defensor) a partir dos chutes sofridos.

    ``match_ids`` vem do mais recente para o mais antigo. Com ``recency=True`` a razão contra a liga
    (``ratio_vs_league``) pondera os jogos por recência (janela curta da Análise de partida); com
    ``False`` todos pesam igual (perfil de temporada). ``ratio_recent``/``trend`` comparam os
    últimos jogos com a janela toda nos dois casos.
    Os valores "por 90" e totais continuam descritivos (sem peso).
    """
    n = max(1, len(match_ids))
    rank = {mid: i for i, mid in enumerate(match_ids)}
    weights = [(_recency_weight(i) if recency else 1.0) for i in range(len(match_ids))] or [1.0]
    w_total = sum(weights)
    recent_n = min(n, RECENT_FORM_MATCHES)

    xg_by: Dict[str, float] = defaultdict(float)
    xg_w: Dict[str, float] = defaultdict(float)
    xg_recent: Dict[str, float] = defaultdict(float)
    shots_by: Dict[str, int] = defaultdict(int)
    goals_by: Dict[str, int] = defaultdict(int)
    for e in events:
        if e.team_id in team_ids:
            continue  # só o que o time SOFREU
        _, zone = _own_zone(e)
        xg = _xg(e)
        r = rank.get(e.match_id)
        xg_by[zone] += xg
        xg_w[zone] += xg * (_recency_weight(r) if (recency and r is not None) else 1.0)
        if r is not None and r < RECENT_FORM_MATCHES:
            xg_recent[zone] += xg
        shots_by[zone] += 1
        goals_by[zone] += 1 if _is_goal(e) else 0

    total_xga = sum(xg_by.values())
    out = []
    for zone in ZONE_ORDER:
        z = zone.value
        base = base_def.get(z, 0.0)
        # média ponderada por jogo x n jogos = "total equivalente" para o mesmo encolhimento de antes
        ratio = _zone_ratio((xg_w.get(z, 0.0) / w_total) * n, n, base)
        # Zona em que ninguém finaliza (nem a liga, nem este time): sem informação -> sem fraqueza.
        # (Antes saía 0,5 = "na média" e pintava de vermelho alas e meio-campo sem dado nenhum.)
        informative = base > 1e-9 or xg_by.get(z, 0.0) > 0
        ratio_recent = _zone_ratio(xg_recent.get(z, 0.0), recent_n, base)
        trend = "stable"
        if n >= 2 * RECENT_FORM_MATCHES - 2:
            if ratio_recent - ratio >= 0.2:
                trend = "worse"
            elif ratio - ratio_recent >= 0.2:
                trend = "better"
        shots_z = shots_by.get(z, 0)
        goals_z = goals_by.get(z, 0)
        xga_z = xg_by.get(z, 0.0)
        out.append({
            "zone": z,
            "weakness_score": round(clamp(ratio / 2.0), 4) if informative else 0.0,
            "ratio_vs_league": round(ratio, 3),
            "ratio_recent": round(ratio_recent, 3),
            "trend": trend,
            "shots_conceded": shots_z,
            "goals_conceded": goals_z,
            "xga": round(xga_z, 3),
            "xg_per_shot": round(xga_z / shots_z, 3) if shots_z else None,
            # > 0: sofreu mais gols do que o xG dos chutes (goleiro/finalização adversária acima do esperado)
            "goals_minus_xga": round(goals_z - xga_z, 3),
            "share_of_xga_pct": round(100 * xga_z / total_xga, 1) if total_xga > 0 else 0.0,
            "reliability": _zone_reliability(shots_z, len(match_ids)),
            "shots_conceded_per_90": round(shots_z / n, 3),
            "xga_per_90": round(xga_z / n, 3),
            "goals_conceded_per_90": round(goals_z / n, 3),
            "sample_size": len(match_ids),
        })
    return out


def _attack_profile(events: List[Event], team_ids: set, match_ids: List[int], base_att: Dict[str, float]) -> List[Dict[str, Any]]:
    n = max(1, len(match_ids))
    xg_by: Dict[str, float] = defaultdict(float)
    for e in events:
        if e.team_id in team_ids:
            a, _ = _own_zone(e)
            xg_by[a] += _xg(e)
    out = []
    for zone in ZONE_ORDER:
        z = zone.value
        informative = base_att.get(z, 0.0) > 1e-9 or xg_by.get(z, 0.0) > 0
        ratio = _zone_ratio(xg_by.get(z, 0.0), n, base_att.get(z, 0.0))
        out.append({"zone": z, "strength_score": round(clamp(ratio / 2.0), 4) if informative else 0.0})
    return out


def _player_rows(events: List[Event], team_ids: set, n_matches: int) -> Dict[int, Dict[str, Any]]:
    """Agrega os chutes recentes de cada jogador do time."""
    players: Dict[int, Dict[str, Any]] = {}
    for e in events:
        if e.team_id not in team_ids or e.player_id is None:
            continue
        a, _ = _own_zone(e)
        p = players.setdefault(e.player_id, {
            "player_id": e.player_id, "name": _player_name(e.player) or f"Jogador {e.player_id}",
            "shots": 0, "on_target": 0, "goals": 0, "xg": 0.0, "assists": 0,
            "zones": defaultdict(lambda: {"n": 0, "xg": 0.0}),
        })
        p["shots"] += 1
        p["on_target"] += 1 if _on_target(e) else 0
        p["goals"] += 1 if _is_goal(e) else 0
        p["xg"] += _xg(e)
        p["zones"][a]["n"] += 1
        p["zones"][a]["xg"] += _xg(e)
    # Assistências: quantas vezes o nome do jogador aparece como "assisted_by" em chutes do time.
    by_name = {norm_person(p["name"]): p for p in players.values()}
    for e in events:
        if e.team_id not in team_ids:
            continue
        who = norm_person((e.details or {}).get("assisted_by"))
        if not who:
            continue
        for key, p in by_name.items():
            if _same_person(who, key):
                p["assists"] += 1
                break
    return players


def _opp_factor(player: Dict[str, Any], opp_weak: Dict[str, Dict[str, Any]], weight_key: str) -> float:
    """Fraqueza média da defesa adversária nas zonas onde o jogador finaliza (1,0 = média)."""
    total = sum(z[weight_key] for z in player["zones"].values())
    if total <= 0:
        return 1.0
    f = 0.0
    for attack_zone, z in player["zones"].items():
        # zona de ataque do chutador -> zona própria da defesa adversária
        defender_zone = _flip_attack_zone(attack_zone)
        f += (z[weight_key] / total) * opp_weak.get(defender_zone, {}).get("ratio_vs_league", 1.0)
    return clamp(f, 0.6, 1.6)


# Centro (x, y em 0–100, time atacando para x=100) de cada zona da tela — mesma geometria do front.
_ZONE_CENTER = {
    "own_box": (8, 50), "own_left_channel": (23, 28), "own_right_channel": (23, 72),
    "own_central_midfield": (23, 50), "own_left_flank": (23, 9), "own_right_flank": (23, 91),
    "neutral_midfield": (50, 50), "neutral_left_flank": (50, 9), "neutral_right_flank": (50, 91),
    "opp_left_flank": (77, 9), "opp_right_flank": (77, 91), "opp_left_channel": (77, 28),
    "opp_right_channel": (77, 72), "opp_central_midfield": (77, 50),
    "outside_box_left": (88, 30.5), "outside_box_right": (88, 69.5), "outside_box_central": (88, 50),
    "central_box": (96, 50),
}
_ATTACK_ZONES = set(ZONE_LABEL_PT)


def _flip_attack_zone(zone: str) -> str:
    """Zona (visão do atacante) -> mesma região na visão do defensor (campo girado 180°)."""
    pt = _ZONE_CENTER.get(zone)
    if pt is None:
        return zone
    return classify_zone(100 - pt[0], 100 - pt[1])


def _poisson(lmbda: float) -> float:
    return 1.0 - math.exp(-max(0.0, lmbda))


def _confidence(shots: int, expected_90s: Optional[float] = None) -> str:
    level = 2 if shots >= 12 else (1 if shots >= 6 else 0)
    if expected_90s is not None and expected_90s < 0.4:
        level = max(0, level - 1)  # poucos minutos recentes: menos certeza
    return ("low", "medium", "high")[level]


def _minutes_profile(mins: List[int]) -> Dict[str, float]:
    """Minutos recentes (do mais novo ao mais antigo) -> total em jogos de 90' e minutos esperados."""
    weights = [0.5 ** (i / MINUTES_HALF_LIFE) for i in range(len(mins))]
    expected = sum(w * m for w, m in zip(weights, mins)) / max(sum(weights), 1e-9)
    return {
        "total_90s": sum(mins) / 90.0,
        "expected_90s": max(0.0, min(1.33, expected / 90.0)),
        "starts": float(sum(1 for m in mins if m >= 60)),
    }


def _pooled_rates(players: Dict[int, Dict[str, Any]], profiles: Dict[int, Dict[str, float]]) -> Dict[str, float]:
    """Taxa por 90' do time inteiro (jogadores com minutos conhecidos): a âncora do encolhimento."""
    total_90 = sum(pr["total_90s"] for pid, pr in profiles.items() if pid in players)
    if total_90 <= 0:
        return {}
    pool = {"shots": 0.0, "on_target": 0.0, "goal": 0.0, "assist": 0.0}
    for pid, pr in profiles.items():
        p = players.get(pid)
        if p is None:
            continue
        pool["shots"] += p["shots"]
        pool["on_target"] += p["on_target"]
        pool["goal"] += 0.6 * p["xg"] + 0.4 * p["goals"]
        pool["assist"] += p["assists"]
    return {k: v / total_90 for k, v in pool.items()}


def _predictions_for_team(
    side: str, team_id: int, players: Dict[int, Dict[str, Any]], n_matches: int,
    opp_weak: Dict[str, Dict[str, Any]], opp_name: str,
    minutes: Optional[Dict[int, List[int]]] = None,
    opp_gk: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Estimativas por jogador.

    * Sem ``minutes``: taxa por jogo do TIME (como antes).
    * Com ``minutes`` (Lineup/PlayerMatchStatistics): taxa por 90' encolhida para a média do time
      (poucos minutos = menos extremo) x minutos esperados (recência ponderada). Quem vem sendo
      poupado/lesionado perde probabilidade; quem joga 90' não é penalizado por jogos que não disputou.
    * ``opp_gk``: goleiro adversário (``index_service.team_goalkeeper``) ajusta só gol e participação em gol.
    """
    home_mult = 1.05 if side == "home" else 0.95
    ranked = sorted(players.values(), key=lambda p: (p["xg"] + 0.3 * p["shots"]), reverse=True)[:TOP_PLAYERS]
    preds: List[Dict[str, Any]] = []
    matchups: List[Dict[str, Any]] = []
    n = max(1, n_matches)
    profiles = {pid: _minutes_profile(mins) for pid, mins in (minutes or {}).items() if mins}
    pool = _pooled_rates(players, profiles)
    gk_factor = (opp_gk or {}).get("goal_factor")
    gk_name = (opp_gk or {}).get("name")

    for p in ranked:
        f_shot = _opp_factor(p, opp_weak, "n")
        f_xg = _opp_factor(p, opp_weak, "xg")
        prof = profiles.get(p["player_id"]) if pool else None

        def per_match(value: float, pool_key: str) -> float:
            if prof is None:
                return value / n
            rate_90 = (value + SHRINK_K * pool.get(pool_key, 0.0)) / (prof["total_90s"] + SHRINK_K)
            return rate_90 * prof["expected_90s"]

        goal_value = 0.6 * p["xg"] + 0.4 * p["goals"]
        shots_pm = per_match(p["shots"], "shots")
        sot_pm = per_match(p["on_target"], "on_target")
        goal_pm = per_match(goal_value, "goal")
        assist_pm = per_match(p["assists"], "assist")
        gk_mult = gk_factor if gk_factor else 1.0
        rates = {
            "shot": (shots_pm, f_shot, 1.0),
            "shot_on_target": (sot_pm, f_shot, 1.0),
            "goal": (goal_pm, f_xg, gk_mult),
            "goal_involvement": (goal_pm + 0.8 * assist_pm, f_xg, gk_mult),
        }
        expected_min = round(prof["expected_90s"] * 90) if prof else None
        total_shots = max(1, p["shots"])
        zone_opps = []
        for zone in ZONE_ORDER:
            z = p["zones"].get(zone.value)
            freq = (z["n"] / total_shots) if z else 0.0
            off = clamp(((z["xg"] / n) if z else 0.0) / 0.4)
            weak = opp_weak.get(_flip_attack_zone(zone.value), {}).get("weakness_score", 0.0) if zone.value in _ATTACK_ZONES else 0.0
            opp = off * weak * (0.4 + 0.6 * freq)
            if zone.value == "central_box" or zone.value == "outside_box_central":
                opp *= 1.25
            zone_opps.append({
                "zone": zone.value, "opportunity_score": round(opp, 5),
                "offensive_strength": round(off, 4), "defensive_weakness": round(weak, 4),
                "player_frequency": round(freq, 4),
            })
        zone_opps.sort(key=lambda z: z["opportunity_score"], reverse=True)

        top_zone = max(p["zones"].items(), key=lambda kv: kv[1]["n"])[0] if p["zones"] else None
        positives: List[Dict[str, str]] = []
        negatives: List[Dict[str, str]] = []
        positives.append({"feature": "shots_pm", "factor": f"{shots_pm:.1f} chutes por jogo ({p['shots']} nos últimos {n})"})
        if p["xg"] > 0:
            positives.append({"feature": "xg_pm", "factor": f"xG de {p['xg'] / n:.2f} por jogo"})
        if p["goals"]:
            positives.append({"feature": "goals", "factor": f"{p['goals']} gol(s) nos últimos {n} jogos"})
        if top_zone in ZONE_LABEL_PT:
            share = round(100 * p["zones"][top_zone]["n"] / total_shots)
            positives.append({"feature": "top_zone", "factor": f"{share}% dos chutes: {ZONE_LABEL_PT[top_zone]}"})
        if f_shot >= 1.12:
            positives.append({"feature": "opp_weak", "factor": f"{opp_name} cede acima da média onde ele finaliza (x{f_shot:.2f})"})
        elif f_shot <= 0.9:
            negatives.append({"feature": "opp_strong", "factor": f"{opp_name} cede menos que a média onde ele finaliza (x{f_shot:.2f})"})
        if prof is not None:
            if expected_min >= 70:
                positives.append({"feature": "minutes", "factor": f"deve jogar ~{expected_min}' (titular nos últimos jogos)"})
            elif expected_min < 45:
                negatives.append({"feature": "minutes", "factor": f"poucos minutos recentes (~{expected_min}' esperados)"})
            else:
                negatives.append({"feature": "minutes", "factor": f"minutos limitados (~{expected_min}' esperados)"})
        if gk_factor and gk_name:
            if gk_factor <= 0.96:
                negatives.append({"feature": "opp_gk", "factor": f"goleiro {gk_name} evita gols acima da média (x{gk_factor:.2f})"})
            elif gk_factor >= 1.04:
                positives.append({"feature": "opp_gk", "factor": f"goleiro {gk_name} defende abaixo da média (x{gk_factor:.2f})"})
        if p["shots"] < 6:
            negatives.append({"feature": "sample", "factor": f"amostra pequena ({p['shots']} chutes)"})
        if side == "away":
            negatives.append({"feature": "venue", "factor": "joga fora de casa"})

        for target, (rate, factor, gk_adj) in rates.items():
            base = _poisson(rate)
            prob = _poisson(rate * factor * home_mult * gk_adj)
            preds.append({
                "player_id": p["player_id"], "player_name": p["name"], "team_id": team_id,
                "target": target, "probability": round(prob, 4), "baseline_probability": round(base, 4),
                "venue": side, "confidence": _confidence(p["shots"], prof["expected_90s"] if prof else None),
                "positive_factors": positives, "negative_factors": negatives,
                "zone_opportunities": zone_opps, "model_version": METHOD,
                # Taxas usadas no cálculo (alimentam o gráfico de dispersão da tela).
                "shots_per_match": round(shots_pm, 3), "xg_per_match": round(p["xg"] / n, 3),
                "rate_per_match": round(rate, 3), "opp_factor": round(factor, 3),
                "expected_minutes": expected_min, "minutes_known": prof is not None,
                "gk_factor": round(gk_adj, 3) if gk_factor else None,
            })

        # Confronto: atacante x defesa adversária.
        score = clamp(0.5 + (f_xg - 1.0) * 0.8, 0.05, 0.95)
        weak_zones = sorted(
            (z for z in opp_weak.values() if z["ratio_vs_league"] >= 1.1 and z["zone"] in _DEFENSE_ZONES),
            key=lambda z: z["ratio_vs_league"], reverse=True,
        )[:3]
        strengths = [f"{shots_pm:.1f} chutes e {p['xg'] / n:.2f} xG por jogo"]
        if top_zone in ZONE_LABEL_PT:
            strengths.append(f"Finaliza mais pela {ZONE_LABEL_PT[top_zone]}")
        weaknesses = [
            f"{opp_name} cede {z['ratio_vs_league']:.1f}x a média em {_own_zone_label(z['zone'])}" for z in weak_zones
        ] or [f"{opp_name} sem fraqueza clara nos últimos jogos"]
        matchups.append({
            "attacker_id": p["player_id"], "attacker_name": p["name"],
            "defender_id": None, "defender_name": f"defesa do {opp_name}",
            "score": round(score, 3), "strengths": strengths, "weaknesses": weaknesses, "evidence": [],
        })
    return preds, matchups


_DEFENSE_ZONES = {"own_box", "own_left_channel", "own_right_channel", "own_central_midfield",
                   "own_left_flank", "own_right_flank", "neutral_midfield"}
_OWN_LABEL = {
    "own_box": "a própria área", "own_left_channel": "o corredor esquerdo", "own_right_channel": "o corredor direito",
    "own_central_midfield": "o meio central", "own_left_flank": "a ala esquerda", "own_right_flank": "a ala direita",
    "neutral_midfield": "o meio-campo",
}


def _actual_side(events: List[Event], team_ids: set) -> Dict[str, Any]:
    """O que cada jogador do time FEZ de fato na partida: chutes, no alvo, gols e assistências."""
    real = [e for e in events if not _is_own_goal(e)]
    rows = _player_rows(real, team_ids, 1)
    assists: Dict[str, int] = defaultdict(int)  # só assistência que virou gol
    for e in real:
        if e.team_id in team_ids and _is_goal(e):
            who = norm_person((e.details or {}).get("assisted_by"))
            if who:
                assists[who] += 1
    return {"rows": rows, "assists": dict(assists)}


def _find_actual(rows: Dict[int, Dict[str, Any]], player_id: int, name: str) -> Optional[Dict[str, Any]]:
    row = rows.get(player_id)
    if row is not None:
        return row
    key = norm_person(name)
    for other in rows.values():  # mesmo jogador cadastrado com outro id (outra fonte)
        if _same_person(key, norm_person(other["name"])):
            return other
    return None


# Lado da partida com escalação/minutos só é confiável se trouxer o elenco completo de quem jogou.
_MIN_PLAYED_FOR_TRUST = 11


def _appearances(db: Session, m: Match, side_ids: Dict[str, set]) -> Dict[str, Optional[List[List[str]]]]:
    """Quem entrou em campo na partida, por lado (nomes normalizados em tokens).

    Junta as linhas da mesma partida vindas de outras fontes (ESPN, FBref, StatsBomb), que são as
    que trazem escalação/minutos. ``None`` no lado = sem dado confiável (não dá para afirmar
    "não jogou")."""
    root = m.canonical_match_id or m.id
    sibling_ids = list(db.scalars(
        select(Match.id).where(or_(Match.id == root, Match.canonical_match_id == root, Match.id == m.id))
    ).all())
    played: Dict[int, int] = {}  # player_id -> team_id
    for team_id, pid, starter, minutes in db.execute(
        select(Lineup.team_id, Lineup.player_id, Lineup.is_starter, Lineup.minutes_played)
        .where(Lineup.match_id.in_(sibling_ids))
    ).all():
        if starter or (minutes or 0) > 0:
            played[pid] = team_id
    for team_id, pid, minutes in db.execute(
        select(PlayerMatchStatistics.team_id, PlayerMatchStatistics.player_id, PlayerMatchStatistics.minutes_played)
        .where(PlayerMatchStatistics.match_id.in_(sibling_ids))
    ).all():
        if (minutes or 0) > 0:
            played[pid] = team_id
    names: Dict[str, List[List[str]]] = {"home": [], "away": []}
    if played:
        for p in db.scalars(select(Player).where(Player.id.in_(list(played)))).all():
            side = next((k for k, ids in side_ids.items() if played[p.id] in ids), None)
            if side:
                names[side].append(norm_person(_player_name(p)).split())
    return {k: (v if len(v) >= _MIN_PLAYED_FOR_TRUST else None) for k, v in names.items()}


def _did_play(name: str, roster: List[List[str]]) -> bool:
    """Generoso de propósito: na dúvida considera que jogou (nunca acusa "não jogou" sem certeza)."""
    tokens = norm_person(name).split()
    return any(_name_match(tokens, other) >= 1 or _same_person(" ".join(tokens), " ".join(other))
               for other in roster)


def attach_outcomes(preds: List[Dict[str, Any]], actual: Dict[str, Dict[str, Any]],
                    appearances: Optional[Dict[str, Optional[List[List[str]]]]] = None) -> None:
    """Marca cada estimativa com o que aconteceu: ``outcome = {happened, count, played}``.

    ``played``: True/False quando a escalação da partida é conhecida (False = nem entrou em
    campo), ``None`` quando não há dado de escalação."""
    for pr in preds:
        side = actual.get(pr.get("venue") or "") or {"rows": {}, "assists": {}}
        row = _find_actual(side["rows"], pr["player_id"], pr["player_name"])
        shots = row["shots"] if row else 0
        on_target = row["on_target"] if row else 0
        goals = row["goals"] if row else 0
        key = norm_person(pr["player_name"])
        assists = sum(c for who, c in side["assists"].items() if _same_person(who, key))
        count = {"shot": shots, "shot_on_target": on_target, "goal": goals,
                 "goal_involvement": goals + assists}[pr["target"]]
        happened = count > 0
        roster = (appearances or {}).get(pr.get("venue") or "")
        if happened or row is not None or assists:
            played: Optional[bool] = True          # fez algo na partida, então jogou
        elif roster is None:
            played = None
        else:
            played = _did_play(pr["player_name"], roster)
        pr["outcome"] = {"happened": happened, "count": int(count), "played": played}


def _own_zone_label(zone: str) -> str:
    return _OWN_LABEL.get(zone, zone.replace("_", " "))


def _safe(db: Session, fn, what: str):
    """Executa um bloco opcional; erro vira log e ``None`` (não derruba a tela de Análise)."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        log.warning("shot_insights: %s indisponível", what, exc_info=True)
        # Em PostgreSQL uma consulta que falha deixa a transação "abortada"; limpa para as próximas.
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None


def match_insights(db: Session, m: Match) -> Dict[str, Any]:
    """Zonas, previsões e confrontos de uma partida, calculados dos chutes reais anteriores a ela."""
    home_ids = _team_ids_like(db, m.home_team)
    away_ids = _team_ids_like(db, m.away_team)
    home_recent = _recent_match_ids(db, home_ids, m.kickoff_time, WINDOW)
    away_recent = _recent_match_ids(db, away_ids, m.kickoff_time, WINDOW)
    base = {"available": False, "match_id": m.id, "method": METHOD}
    if not home_recent and not away_recent:
        return {**base, "notes": ["Sem chutes anteriores a esta partida para os dois times."]}

    home_events = _load_shot_events(db, home_recent)
    away_events = _load_shot_events(db, away_recent)
    att_base, def_base, league_n = _league_baseline(db, m, home_events + away_events)

    hset, aset = set(home_ids), set(away_ids)
    home_weak = _defense_profile(home_events, hset, home_recent, def_base)
    away_weak = _defense_profile(away_events, aset, away_recent, def_base)
    weak_home_map = {z["zone"]: z for z in home_weak}
    weak_away_map = {z["zone"]: z for z in away_weak}

    home_players = _player_rows(home_events, hset, len(home_recent))
    away_players = _player_rows(away_events, aset, len(away_recent))
    home_name = m.home_team.name if m.home_team else "mandante"
    away_name = m.away_team.name if m.away_team else "visitante"

    # Dados opcionais (FBref/Lineup): se faltarem ou falharem, a análise segue só com os chutes.
    home_gk = _safe(db, lambda: team_goalkeeper(db, home_ids), "goleiro do mandante")
    away_gk = _safe(db, lambda: team_goalkeeper(db, away_ids), "goleiro do visitante")
    home_minutes = _safe(db, lambda: recent_minutes(db, list(home_players), home_recent), "minutos do mandante") or {}
    away_minutes = _safe(db, lambda: recent_minutes(db, list(away_players), away_recent), "minutos do visitante") or {}

    # Atacantes do mandante enfrentam a defesa e o goleiro do visitante (e vice-versa).
    p1, m1 = _predictions_for_team("home", m.home_team_id, home_players, len(home_recent), weak_away_map, away_name,
                                   minutes=home_minutes, opp_gk=away_gk)
    p2, m2 = _predictions_for_team("away", m.away_team_id, away_players, len(away_recent), weak_home_map, home_name,
                                   minutes=away_minutes, opp_gk=home_gk)
    matchups = sorted(m1 + m2, key=lambda x: abs(x["score"] - 0.5), reverse=True)

    # Partida encerrada: a estimativa continua sendo a feita só com jogos anteriores, e cada
    # linha ganha o que de fato aconteceu (os chutes chegam ao fim do jogo). Sem chutes da
    # partida coletados, não marca nada (evita mostrar "não" por falta de dado).
    results_checked = False
    if (m.status or "").lower() == "finished":
        actual_events = _safe(db, lambda: _load_shot_events(db, [m.id]), "chutes da partida") or []
        if actual_events:
            roster = _safe(db, lambda: _appearances(db, m, {"home": hset, "away": aset}), "escalação da partida")
            attach_outcomes(p1, {"home": _actual_side(actual_events, hset)}, roster)
            attach_outcomes(p2, {"away": _actual_side(actual_events, aset)}, roster)
            results_checked = True

    notes = [
        f"Baseado nos últimos {len(home_recent)} jogos do mandante e {len(away_recent)} do visitante com chutes reais (Understat), "
        f"comparados à média de {league_n} jogos da liga.",
        "Só jogos anteriores a esta partida entram no cálculo.",
        "Probabilidade = chance de pelo menos 1 evento (Poisson), ajustada pela fraqueza da defesa adversária.",
    ]
    if home_minutes or away_minutes:
        notes.append("Taxas por 90' suavizadas para a média do time e multiplicadas pelos minutos esperados (jogos recentes pesam mais).")
    if (home_gk and home_gk.get("goal_factor")) or (away_gk and away_gk.get("goal_factor")):
        notes.append("Chance de gol também considera o desempenho do goleiro adversário (defesas vs. esperado, FBref).")
    return {
        **base,
        "available": True,
        "sample": {"home_matches": len(home_recent), "away_matches": len(away_recent), "league_matches": league_n},
        "zones": {
            "home_team_weaknesses": home_weak,
            "away_team_weaknesses": away_weak,
            "home_team_attack": _attack_profile(home_events, hset, home_recent, att_base),
            "away_team_attack": _attack_profile(away_events, aset, away_recent, att_base),
        },
        "goalkeepers": {"home": home_gk, "away": away_gk},
        "predictions": p1 + p2,
        "results_checked": results_checked,
        "matchups": matchups,
        "notes": notes,
        "generated_at": datetime.utcnow().isoformat(),
    }
