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

import math
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.models import Event, EventType, Match, ZONE_ORDER
from app.services.studio import (
    _load_shot_events, _player_name, _recent_match_ids, _same_person, _team_ids_like, norm_person,
)

WINDOW = 10            # jogos recentes de cada time
LEAGUE_WINDOW = 120    # jogos da temporada usados como média da liga
PRIOR_MATCHES = 3.0    # "jogos fictícios na média" que suavizam amostras pequenas
TOP_PLAYERS = 8        # jogadores por time na lista de previsões

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
    ids: List[int] = []
    if m.season_id is not None:
        ids = list(db.scalars(
            select(Match.id)
            .where(
                Match.season_id == m.season_id,
                Match.kickoff_time < m.kickoff_time,
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


def _defense_profile(events: List[Event], team_ids: set, match_ids: List[int], base_def: Dict[str, float]) -> List[Dict[str, Any]]:
    """Fraqueza defensiva por zona (zona própria do defensor) a partir dos chutes sofridos."""
    n = max(1, len(match_ids))
    xg_by: Dict[str, float] = defaultdict(float)
    shots_by: Dict[str, int] = defaultdict(int)
    goals_by: Dict[str, int] = defaultdict(int)
    for e in events:
        if e.team_id in team_ids:
            continue  # só o que o time SOFREU
        _, zone = _own_zone(e)
        xg_by[zone] += _xg(e)
        shots_by[zone] += 1
        goals_by[zone] += 1 if _is_goal(e) else 0
    out = []
    for zone in ZONE_ORDER:
        z = zone.value
        ratio = _zone_ratio(xg_by.get(z, 0.0), n, base_def.get(z, 0.0))
        out.append({
            "zone": z,
            "weakness_score": round(clamp(ratio / 2.0), 4),
            "ratio_vs_league": round(ratio, 3),
            "shots_conceded_per_90": round(shots_by.get(z, 0) / n, 3),
            "xga_per_90": round(xg_by.get(z, 0.0) / n, 3),
            "goals_conceded_per_90": round(goals_by.get(z, 0) / n, 3),
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
    return [
        {
            "zone": zone.value,
            "strength_score": round(clamp(_zone_ratio(xg_by.get(zone.value, 0.0), n, base_att.get(zone.value, 0.0)) / 2.0), 4),
        }
        for zone in ZONE_ORDER
    ]


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


def _confidence(shots: int) -> str:
    return "high" if shots >= 12 else ("medium" if shots >= 6 else "low")


def _predictions_for_team(
    side: str, team_id: int, players: Dict[int, Dict[str, Any]], n_matches: int,
    opp_weak: Dict[str, Dict[str, Any]], opp_name: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    home_mult = 1.05 if side == "home" else 0.95
    ranked = sorted(players.values(), key=lambda p: (p["xg"] + 0.3 * p["shots"]), reverse=True)[:TOP_PLAYERS]
    preds: List[Dict[str, Any]] = []
    matchups: List[Dict[str, Any]] = []
    n = max(1, n_matches)
    for p in ranked:
        f_shot = _opp_factor(p, opp_weak, "n")
        f_xg = _opp_factor(p, opp_weak, "xg")
        shots_pm = p["shots"] / n
        sot_pm = p["on_target"] / n
        goal_pm = (0.6 * p["xg"] + 0.4 * p["goals"]) / n
        assist_pm = p["assists"] / n
        rates = {
            "shot": (shots_pm, f_shot),
            "shot_on_target": (sot_pm, f_shot),
            "goal": (goal_pm, f_xg),
            "goal_involvement": (goal_pm + 0.8 * assist_pm, f_xg),
        }
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
        if p["shots"] < 6:
            negatives.append({"feature": "sample", "factor": f"amostra pequena ({p['shots']} chutes)"})
        if side == "away":
            negatives.append({"feature": "venue", "factor": "joga fora de casa"})

        for target, (rate, factor) in rates.items():
            base = _poisson(rate)
            prob = _poisson(rate * factor * home_mult)
            preds.append({
                "player_id": p["player_id"], "player_name": p["name"], "team_id": team_id,
                "target": target, "probability": round(prob, 4), "baseline_probability": round(base, 4),
                "venue": side, "confidence": _confidence(p["shots"]),
                "positive_factors": positives, "negative_factors": negatives,
                "zone_opportunities": zone_opps, "model_version": "shot-poisson@1",
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


def _own_zone_label(zone: str) -> str:
    return _OWN_LABEL.get(zone, zone.replace("_", " "))


def match_insights(db: Session, m: Match) -> Dict[str, Any]:
    """Zonas, previsões e confrontos de uma partida, calculados dos chutes reais anteriores a ela."""
    home_ids = _team_ids_like(db, m.home_team)
    away_ids = _team_ids_like(db, m.away_team)
    home_recent = _recent_match_ids(db, home_ids, m.kickoff_time, WINDOW)
    away_recent = _recent_match_ids(db, away_ids, m.kickoff_time, WINDOW)
    base = {"available": False, "match_id": m.id, "method": "shot-poisson@1"}
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
    # Atacantes do mandante enfrentam a defesa do visitante (e vice-versa).
    p1, m1 = _predictions_for_team("home", m.home_team_id, home_players, len(home_recent), weak_away_map, away_name)
    p2, m2 = _predictions_for_team("away", m.away_team_id, away_players, len(away_recent), weak_home_map, home_name)
    matchups = sorted(m1 + m2, key=lambda x: abs(x["score"] - 0.5), reverse=True)

    notes = [
        f"Baseado nos últimos {len(home_recent)} jogos do mandante e {len(away_recent)} do visitante com chutes reais (Understat), "
        f"comparados à média de {league_n} jogos da liga.",
        "Só jogos anteriores a esta partida entram no cálculo.",
        "Probabilidade = chance de pelo menos 1 evento (Poisson), ajustada pela fraqueza da defesa adversária.",
    ]
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
        "predictions": p1 + p2,
        "matchups": matchups,
        "notes": notes,
        "generated_at": datetime.utcnow().isoformat(),
    }
