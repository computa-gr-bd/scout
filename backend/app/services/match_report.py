"""Relatório de análise pré-jogo: transforma as estatísticas em respostas de decisão.

Responde, com os números que justificam cada leitura:

* quais são as principais fragilidades defensivas de cada time;
* qual time concede mais finalizações;
* por qual lado do campo cada ataque encontra mais oportunidades;
* quais jogadores têm maior participação ofensiva;
* quais são as tendências estatísticas do confronto (forma recente × janela, confrontos diretos);
* quais fatores favorecem cada equipe;
* qual é a estimativa estatística de gols e finalizações.

Não usa modelo treinado nem dado novo: reaproveita ``shot_insights.match_insights`` (zonas fracas,
probabilidades por jogador, goleiros) e os mesmos chutes reais (Understat) anteriores à partida.

Matemática (``stats_math``): suavização bayesiana das forças de ataque/defesa para a média da liga,
Poisson para os gols (1×2, Over 2,5, ambos marcam; sem placar exato), binomial negativa para os chutes,
tendência recente × janela (``form_trend``) e análise de sensibilidade (cenários).

Este módulo é dividido em duas partes: funções **puras** (``aggregate_team``, ``build_report``) e
``generate_match_report``, que busca os chutes no banco (importações do banco ficam dentro da função).
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from app.services import stats_math as sm

METHOD = "pregame-report@1"
RECENT = 5                 # janela da "forma recente" (igual a shot_insights.RECENT_FORM_MATCHES)
SHOTS_DISPERSION_PRIOR = 0.04   # alfa a priori da binomial negativa de chutes DO TIME (bem menor que o de um jogador)
MIN_TREND_MATCHES = 6
HOME_MULT, AWAY_MULT = 1.05, 0.95   # mesmo ajuste de mando de shot_insights
GOAL_XG_WEIGHT = 0.6       # valor de gols = 0,6 xG + 0,4 gols (igual a shot_insights)
GK_CLAMP = (0.85, 1.15)
LANES = ("left", "center", "right")
LANE_LABEL = {"left": "esquerda", "center": "centro", "right": "direita"}
LANE_PREP = {"left": "pela esquerda", "center": "pelo centro", "right": "pela direita"}
TARGET_FIELDS = (
    "shots_for", "sot_for", "xg_for", "goals_for", "sp_xg_for",
    "shots_against", "sot_against", "xg_against", "goals_against", "sp_xg_against",
)

# Zonas "do defensor" (mesmo conjunto de shot_insights._DEFENSE_ZONES) e rótulos para o relatório.
DEFENSE_ZONES = {
    "own_box", "own_left_channel", "own_right_channel", "own_central_midfield",
    "own_left_flank", "own_right_flank", "neutral_midfield",
}
ZONE_TITLE = {
    "own_box": "Dentro da própria área", "own_left_channel": "Corredor esquerdo",
    "own_right_channel": "Corredor direito", "own_central_midfield": "Meio central",
    "own_left_flank": "Ala esquerda", "own_right_flank": "Ala direita", "neutral_midfield": "Meio-campo",
}


# --------------------------------------------------------------------------- formatação
def _n(x: Optional[float], d: int = 2) -> str:
    return "—" if x is None else f"{x:.{d}f}".replace(".", ",")


def _pct(p: Optional[float], d: int = 0) -> str:
    return "—" if p is None else f"{p * 100:.{d}f}%".replace(".", ",")


def _x(ratio: float) -> str:
    return f"{_n(ratio, 2)}×"


# --------------------------------------------------------------------------- chutes → agregados
def lane_of_y(y: float) -> str:
    """Corredor do ataque (visão de quem ataca para x=100): y baixo = esquerda (igual a ``classify_zone``)."""
    return "left" if y < 38 else ("right" if y >= 62 else "center")


def zone_lane(zone: str) -> str:
    return "left" if "left" in zone else ("right" if "right" in zone else "center")


def _xg(e: Any) -> float:
    shot = getattr(e, "shot", None)
    return float(shot.xg) if shot is not None and shot.xg is not None else 0.08


def _is_goal(e: Any) -> bool:
    shot = getattr(e, "shot", None)
    return bool(shot and shot.is_goal) or (e.outcome or "").lower() == "goal"


def _on_target(e: Any) -> bool:
    shot = getattr(e, "shot", None)
    return bool(shot and shot.on_target) or _is_goal(e)


def _is_own_goal(e: Any) -> bool:
    return (e.outcome or "").lower().replace(" ", "").replace("_", "") == "owngoal"


def _situation(e: Any) -> str:
    shot = getattr(e, "shot", None)
    return ((getattr(shot, "situation", None) or "") if shot is not None else "").lower().replace(" ", "").replace("_", "")


def _blank() -> Dict[str, Any]:
    rec: Dict[str, Any] = {k: 0.0 for k in TARGET_FIELDS}
    rec.update({"sit_known": 0, "lane_for": {l: 0.0 for l in LANES}, "lane_against": {l: 0.0 for l in LANES}})
    return rec


def aggregate_team(events: Sequence[Any], team_ids: Sequence[int], match_ids: Sequence[int]) -> Dict[str, Any]:
    """Resume os chutes de um time (a favor e contra) nos ``match_ids`` (do mais recente ao mais antigo).

    ``events``: eventos de chute com ``match_id``, ``team_id``, ``outcome``, ``position.y`` e ``shot``
    (``xg``, ``on_target``, ``is_goal``, ``situation``); gols contra ficam de fora.
    """
    ids = set(team_ids)
    per = {mid: _blank() for mid in match_ids}
    for e in events:
        rec = per.get(e.match_id)
        if rec is None or e.position is None or _is_own_goal(e):
            continue
        side = "for" if e.team_id in ids else "against"
        xg = _xg(e)
        rec[f"shots_{side}"] += 1
        rec[f"xg_{side}"] += xg
        rec[f"goals_{side}"] += 1 if _is_goal(e) else 0
        rec[f"sot_{side}"] += 1 if _on_target(e) else 0
        rec[f"lane_{side}"][lane_of_y(float(e.position.y))] += xg
        sit = _situation(e)
        if sit:
            rec["sit_known"] += 1
            if sit not in ("openplay", "regularplay"):
                rec[f"sp_xg_{side}"] += xg
    rows = [per[m] for m in match_ids]
    return summarize(rows)


def summarize(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(rows)
    out: Dict[str, Any] = {"n": n}
    for k in TARGET_FIELDS:
        total = sum(r[k] for r in rows)
        out[f"{k}_total"] = total
        out[f"{k}_pm"] = total / n if n else 0.0
    out["lane_for_total"] = {l: sum(r["lane_for"][l] for r in rows) for l in LANES}
    out["lane_against_total"] = {l: sum(r["lane_against"][l] for r in rows) for l in LANES}
    known = sum(r["sit_known"] for r in rows) > 0
    out["sp_share_for"] = (out["sp_xg_for_total"] / out["xg_for_total"]) if known and out["xg_for_total"] > 0 else None
    out["sp_share_against"] = (out["sp_xg_against_total"] / out["xg_against_total"]) if known and out["xg_against_total"] > 0 else None
    out["series"] = {k: [r[k] for r in rows] for k in (
        "shots_for", "shots_against", "sot_for", "sot_against", "xg_for", "xg_against")}
    return out


# --------------------------------------------------------------------------- blocos do relatório
def _defensive_weaknesses(weak_list: Sequence[Dict[str, Any]], team: str, limit: int = 3) -> List[Dict[str, Any]]:
    rows = [z for z in weak_list
            if z.get("zone") in DEFENSE_ZONES and (z.get("shots_conceded") or 0) > 0
            and (z.get("ratio_vs_league") or 0) >= 1.0]
    rows.sort(key=lambda z: z["ratio_vs_league"], reverse=True)
    out = []
    for z in rows[:limit]:
        label = ZONE_TITLE.get(z["zone"], z["zone"].replace("_", " "))
        out.append({
            "zone": z["zone"], "label": label,
            "ratio_vs_league": z["ratio_vs_league"], "xga": z.get("xga"),
            "shots_conceded": z.get("shots_conceded"), "goals_conceded": z.get("goals_conceded"),
            "share_of_xga_pct": z.get("share_of_xga_pct"), "trend": z.get("trend", "stable"),
            "reliability": z.get("reliability", "low"),
            "text": (f"{team} cede {_x(z['ratio_vs_league'])} a média da liga em {label.lower()}: "
                     f"{z.get('shots_conceded', 0)} chutes, {_n(z.get('xga') or 0)} xG e "
                     f"{z.get('goals_conceded', 0)} gol(s) sofridos nos últimos {z.get('sample_size', '?')} jogos."),
        })
    return out


def _lane_block(att: Dict[str, Any], dfn: Dict[str, Any], league_lane_pm: Dict[str, float],
                att_name: str, def_name: str) -> Dict[str, Any]:
    """Corredores do ataque de ``att`` contra a defesa de ``dfn`` (ambos na visão de quem ataca)."""
    total_for = sum(att["lane_for_total"].values()) or 0.0
    lanes = []
    for lane in LANES:
        base = league_lane_pm.get(lane, 0.0)
        att_ratio = sm.shrunk_ratio(att["lane_for_total"][lane], att["n"], base)
        def_ratio = sm.shrunk_ratio(dfn["lane_against_total"][lane], dfn["n"], base)
        lanes.append({
            "lane": lane, "label": LANE_LABEL[lane],
            "attack_share_pct": round(100 * att["lane_for_total"][lane] / total_for, 1) if total_for > 0 else 0.0,
            "attack_ratio": round(att_ratio, 3), "defense_ratio": round(def_ratio, 3),
            "opportunity": round(math.sqrt(att_ratio * def_ratio), 3),
        })
    best = max(lanes, key=lambda l: l["opportunity"])
    prep = LANE_PREP[best["lane"]]
    if best["attack_share_pct"] >= 20:
        text = (f"O ataque do {att_name} encontra mais espaço {prep}: {_n(best['attack_share_pct'], 0)}% do xG sai desse lado "
                f"({_x(best['attack_ratio'])} a média) e o {def_name} cede {_x(best['defense_ratio'])} a média por ali.")
    else:
        text = (f"O {def_name} cede {_x(best['defense_ratio'])} a média {prep}, mas o {att_name} usa pouco esse lado "
                f"({_n(best['attack_share_pct'], 0)}% do xG): a oportunidade depende de mudar o corredor de ataque.")
    return {"lanes": lanes, "best": best["lane"], "best_label": best["label"], "best_prep": prep,
            "best_opportunity": best["opportunity"], "text": text}


def _players_block(predictions: Sequence[Dict[str, Any]], side: str, team_xg_pm: float, limit: int = 5) -> List[Dict[str, Any]]:
    rows: Dict[int, Dict[str, Any]] = {}
    for p in predictions:
        if p.get("venue") != side:
            continue
        r = rows.setdefault(p["player_id"], {
            "player_id": p["player_id"], "name": p["player_name"],
            "shots_per_match": p.get("shots_per_match"), "xg_per_match": p.get("xg_per_match"),
            "expected_minutes": p.get("expected_minutes"), "confidence": p.get("confidence"),
            "reasons": [f["factor"] for f in (p.get("positive_factors") or [])[:2]],
            "top_zone": None,
        })
        r[f"p_{p['target']}"] = p.get("probability")
        if p["target"] == "goal_involvement":
            r["involvement_rate"] = p.get("rate_per_match")
        zones = [z for z in (p.get("zone_opportunities") or []) if z.get("opportunity_score", 0) > 0.001]
        if zones and r["top_zone"] is None:
            r["top_zone"] = zones[0]["zone"]
    out = sorted(rows.values(), key=lambda r: r.get("involvement_rate") or 0.0, reverse=True)[:limit]
    for r in out:
        xg_pm = r.get("xg_per_match") or 0.0
        r["xg_share_pct"] = round(100 * xg_pm / team_xg_pm, 1) if team_xg_pm > 0 else None
    return out


def _trend_rows(side: str, name: str, agg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Forma recente (pesos decrescentes nas últimas 5) × janela inteira, via ``stats_math.form_trend``."""
    n = agg["n"]
    if n < MIN_TREND_MATCHES:
        return []
    specs = [
        ("xg_for", "xG criado", "xG criado", True, 2), ("xg_against", "xG sofrido", "xG sofrido", False, 2),
        ("shots_for", "Chutes feitos", "chutes feitos", True, 1),
    ]
    rows = []
    for key, label, phrase, up_is_good, dec in specs:
        form = sm.form_trend(agg["series"][key], recent_n=RECENT)
        direction = form["trend"]
        good = (direction == "up") == up_is_good
        reading = "neutra" if direction == "stable" else ("positiva" if good else "negativa")
        verb = {"up": "subiu", "down": "caiu", "stable": "estável"}[direction]
        rows.append({
            "team": side, "metric": label, "recent": round(form["recent"], 2), "window": round(form["structural"], 2),
            "change_pct": round(form["delta_pct"], 1), "direction": direction, "reading": reading,
            "text": (f"{name}: {phrase} {verb} — {_n(form['recent'], dec)} (média ponderada dos últimos {RECENT}) "
                     f"vs {_n(form['structural'], dec)} em {n} jogos."),
        })
    return rows


def _h2h_block(h2h: Optional[Sequence[Dict[str, Any]]], home_id: int, home_name: str, away_name: str) -> Optional[Dict[str, Any]]:
    games = [g for g in (h2h or []) if g.get("home_score") is not None and g.get("away_score") is not None]
    if len(games) < 2:
        return None
    hw = aw = dr = 0
    goals = 0
    for g in games:
        hs, as_ = g["home_score"], g["away_score"]
        goals += hs + as_
        home_side_is_home = g.get("home_id") == home_id
        mine, theirs = (hs, as_) if home_side_is_home else (as_, hs)
        if mine > theirs:
            hw += 1
        elif mine < theirs:
            aw += 1
        else:
            dr += 1
    avg = goals / len(games)
    return {
        "matches": len(games), "home_wins": hw, "draws": dr, "away_wins": aw, "avg_goals": round(avg, 2),
        "text": (f"Últimos {len(games)} confrontos diretos: {hw} vitória(s) do {home_name}, {dr} empate(s) e "
                 f"{aw} do {away_name}; média de {_n(avg)} gols por jogo."),
    }


def _factors(side: str, c: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fatores que favorecem ``side`` (cada um com o número que o justifica), do mais forte ao mais fraco."""
    me, opp = (c["home"], c["away"]) if side == "home" else (c["away"], c["home"])
    my_agg, opp_agg = me["agg"], opp["agg"]
    att_ratio, def_ratio = (c["att_h"], c["def_a"]) if side == "home" else (c["att_a"], c["def_h"])
    out: List[Dict[str, Any]] = []

    def add(kind: str, text: str, impact: float) -> None:
        out.append({"kind": kind, "text": text, "impact": round(impact, 3)})

    if att_ratio >= 1.08:
        add("attack", f"Ataque acima da média: {_n(my_agg['xg_for_pm'])} xG por jogo ({_x(att_ratio)} a média da liga, já suavizada).",
            att_ratio - 1.0)
    if def_ratio >= 1.08:
        add("opp_defense", f"{opp['name']} cede {_n(opp_agg['xg_against_pm'])} xG por jogo ({_x(def_ratio)} a média da liga).",
            def_ratio - 1.0)
    if my_agg["xg_for_pm"] > 0 and my_agg["n"] >= 4 and opp_agg["shots_against_pm"] > my_agg["shots_against_pm"] + 1.0:
        add("shots", f"{opp['name']} concede {_n(opp_agg['shots_against_pm'], 1)} chutes por jogo, "
                     f"{_n(opp_agg['shots_against_pm'] - my_agg['shots_against_pm'], 1)} a mais que o {me['name']}.", 0.12)
    lane = me["lanes"]
    if lane and lane["best_opportunity"] >= 1.12:
        add("lane", f"Espaço {lane['best_prep']}: oportunidade {_x(lane['best_opportunity'])} a média nesse corredor.",
            lane["best_opportunity"] - 1.0)
    weak = (opp["weak"] or [None])[0]
    if weak and weak["ratio_vs_league"] >= 1.15:
        add("weak_zone", f"{opp['name']} cede {_x(weak['ratio_vs_league'])} a média em {weak['label'].lower()}.",
            weak["ratio_vs_league"] - 1.0)
    gk_own, gk_opp = me["gk"], opp["gk"]
    if gk_own and gk_own.get("goal_factor") and gk_own["goal_factor"] <= 0.96:
        add("goalkeeper", f"Goleiro {gk_own.get('name', '')} evita gols acima do esperado (fator {_n(gk_own['goal_factor'])}×).",
            1.0 - gk_own["goal_factor"])
    if gk_opp and gk_opp.get("goal_factor") and gk_opp["goal_factor"] >= 1.04:
        add("goalkeeper", f"Goleiro adversário {gk_opp.get('name', '')} defende abaixo do esperado (fator {_n(gk_opp['goal_factor'])}×).",
            gk_opp["goal_factor"] - 1.0)
    if side == "home":
        add("venue", f"Mando de campo: taxas do {me['name']} ×{_n(HOME_MULT)} e do visitante ×{_n(AWAY_MULT)}.", 0.05)
    for t in me["trends"]:
        if t["metric"] == "xG criado" and t["reading"] == "positiva":
            add("form", t["text"], abs(t["change_pct"]) / 100)
    for t in opp["trends"]:
        if t["metric"] == "xG sofrido" and t["reading"] == "negativa":
            add("form", t["text"], abs(t["change_pct"]) / 100)
    if me["players"]:
        top = me["players"][0]
        if top.get("p_goal") is not None:
            add("player", f"{top['name']} é a maior ameaça: {_pct(top['p_goal'])} de chance de marcar "
                          f"({_n(top.get('xg_per_match'))} xG por jogo).", min(0.3, top["p_goal"]))
    if (my_agg["sp_share_for"] or 0) >= 0.25 and (opp_agg["sp_share_against"] or 0) >= 0.25:
        add("set_piece", f"Bola parada: {_pct(my_agg['sp_share_for'])} do xG do {me['name']} e {_pct(opp_agg['sp_share_against'])} do xG "
                         f"sofrido pelo {opp['name']} vêm de bola parada.", 0.1)
    out.sort(key=lambda f: f["impact"], reverse=True)
    return out[:5]


def build_report(match: Dict[str, Any], insights: Dict[str, Any], agg: Dict[str, Dict[str, Any]],
                 league: Dict[str, Any], h2h: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Monta o relatório. ``agg``: ``{"home": aggregate_team(...), "away": ...}``; ``league``: médias da temporada."""
    home_n, away_n = match["home"]["name"], match["away"]["name"]
    ah, aa = agg["home"], agg["away"]
    nh, na = ah["n"], aa["n"]
    zones = insights.get("zones") or {}
    gks = insights.get("goalkeepers") or {}
    predictions = insights.get("predictions") or []

    # ---- gols esperados (encolhimento bayesiano + Poisson) -------------------------------------
    def goal_value(a: Dict[str, Any], side: str) -> float:
        return GOAL_XG_WEIGHT * a[f"xg_{side}_total"] + (1 - GOAL_XG_WEIGHT) * a[f"goals_{side}_total"]

    lg = league.get("xg_per_team_match") or 0.0
    if lg <= 1e-9:
        lg = max(0.5, (ah["xg_for_pm"] + ah["xg_against_pm"] + aa["xg_for_pm"] + aa["xg_against_pm"]) / 4)
    lam_h, att_h, def_a = sm.blend_rate(goal_value(ah, "for"), nh, goal_value(aa, "against"), na, lg, HOME_MULT)
    lam_a, att_a, def_h = sm.blend_rate(goal_value(aa, "for"), na, goal_value(ah, "against"), nh, lg, AWAY_MULT)
    # Goleiro: mesmo fator que shot_insights aplica às probabilidades de gol dos jogadores.
    gk_h, gk_a = gks.get("home"), gks.get("away")
    lam_h *= min(GK_CLAMP[1], max(GK_CLAMP[0], (gk_a or {}).get("goal_factor") or 1.0))
    lam_a *= min(GK_CLAMP[1], max(GK_CLAMP[0], (gk_h or {}).get("goal_factor") or 1.0))
    probs = sm.outcome_probs(sm.score_matrix(lam_h, lam_a))

    # Sensibilidade (cenários favorável/base/conservador) da chance de vitória do time em foco.
    focus = "away" if probs["away"] > probs["home"] else "home"
    d_rate = sm.clamp(0.6 / math.sqrt(min(nh, na) + 1.0), 0.05, 0.25)

    def p_focus(rm: float, cm: float) -> float:
        f, o = (lam_h, lam_a) if focus == "home" else (lam_a, lam_h)
        m = sm.score_matrix(f * rm * cm, o / (rm * cm))
        return float(sm.outcome_probs(m)["home"])

    sensitivity = {"focus": focus, **sm.sensitivity(
        p_focus, favorable=(1.0 + d_rate, 1.05), conservative=(1.0 - d_rate, 0.95), stable_range=0.10, fragile_range=0.20)}

    # ---- chutes esperados (binomial negativa) ---------------------------------------------------
    def shots_estimate(for_key: str, against_key: str, series_for: str, series_against: str) -> Dict[str, Any]:
        proxy_vals = [ah[f"{for_key}_pm"], ah[f"{against_key}_pm"], aa[f"{for_key}_pm"], aa[f"{against_key}_pm"]]
        proxy = sum(proxy_vals) / 4
        out = {}
        for side, mult, mine, opp in (("home", HOME_MULT, ah, aa), ("away", AWAY_MULT, aa, ah)):
            if proxy <= 1e-9:
                out[side] = {"mean": 0.0, "low": 0, "high": 0}
                continue
            mean, _, _ = sm.blend_rate(mine[f"{for_key}_total"], mine["n"], opp[f"{against_key}_total"], opp["n"], proxy, mult)
            alpha = sm.estimate_dispersion([mine["series"][series_for], opp["series"][series_against]], prior=SHOTS_DISPERSION_PRIOR)
            low, high = sm.quantile_range(mean, alpha)
            out[side] = {"mean": round(mean, 2), "low": low, "high": high}
        return out

    shots = shots_estimate("shots_for", "shots_against", "shots_for", "shots_against")
    sot = shots_estimate("sot_for", "sot_against", "sot_for", "sot_against")

    # ---- blocos por time -----------------------------------------------------------------------
    league_lane_pm = league.get("lane_xg_pm") or {}
    lanes_h = _lane_block(ah, aa, league_lane_pm, home_n, away_n)
    lanes_a = _lane_block(aa, ah, league_lane_pm, away_n, home_n)
    weak_h = _defensive_weaknesses(zones.get("home_team_weaknesses") or [], home_n)
    weak_a = _defensive_weaknesses(zones.get("away_team_weaknesses") or [], away_n)
    players_h = _players_block(predictions, "home", ah["xg_for_pm"])
    players_a = _players_block(predictions, "away", aa["xg_for_pm"])
    trends_h, trends_a = _trend_rows("home", home_n, ah), _trend_rows("away", away_n, aa)

    # ---- chutes concedidos -----------------------------------------------------------------------
    hs, as_ = ah["shots_against_pm"], aa["shots_against_pm"]
    more = "home" if hs - as_ >= 1.0 else ("away" if as_ - hs >= 1.0 else "even")
    if more == "even":
        conceded_text = (f"Os dois concedem volume parecido de finalizações: {home_n} {_n(hs, 1)} e {away_n} {_n(as_, 1)} por jogo.")
    else:
        worse, better = (home_n, away_n) if more == "home" else (away_n, home_n)
        w, b = (ah, aa) if more == "home" else (aa, ah)
        conceded_text = (f"{worse} concede mais finalizações: {_n(w['shots_against_pm'], 1)} por jogo contra {_n(b['shots_against_pm'], 1)} do {better} "
                         f"(xG sofrido {_n(w['xg_against_pm'])} × {_n(b['xg_against_pm'])}).")

    def conceded(a: Dict[str, Any]) -> Dict[str, Any]:
        return {"shots_per_match": round(a["shots_against_pm"], 2), "on_target_per_match": round(a["sot_against_pm"], 2),
                "xga_per_match": round(a["xg_against_pm"], 2), "goals_per_match": round(a["goals_against_pm"], 2),
                "set_piece_share": None if a["sp_share_against"] is None else round(a["sp_share_against"], 3)}

    ctx = {
        "att_h": att_h, "def_h": def_h, "att_a": att_a, "def_a": def_a,
        "home": {"name": home_n, "agg": ah, "lanes": lanes_h, "weak": weak_h, "gk": gk_h, "players": players_h, "trends": trends_h},
        "away": {"name": away_n, "agg": aa, "lanes": lanes_a, "weak": weak_a, "gk": gk_a, "players": players_a, "trends": trends_a},
    }
    factors = {"home": _factors("home", ctx), "away": _factors("away", ctx)}

    # ---- conclusão -----------------------------------------------------------------------------
    diff = probs["home"] - probs["away"]
    if abs(diff) < 0.08:
        favorite, lead = "even", "Jogo equilibrado"
    else:
        favorite = "home" if diff > 0 else "away"
        name = home_n if favorite == "home" else away_n
        lead = f"{name} tem {'vantagem estatística' if abs(diff) >= 0.2 else 'leve vantagem estatística'}"
    sample_min = min(nh, na)
    confidence = "low" if sample_min < 4 else ("medium" if sample_min < 8 else "high")
    headline = (f"{lead}: gols esperados {_n(lam_h)} × {_n(lam_a)}; vitória {_pct(probs['home'])} / empate {_pct(probs['draw'])} / "
                f"vitória {_pct(probs['away'])}.")
    bullets = [headline, conceded_text, lanes_h["text"], lanes_a["text"]]
    for weak, nm in ((weak_h, home_n), (weak_a, away_n)):
        if weak:
            bullets.append(weak[0]["text"])
    for plist, nm in ((players_h, home_n), (players_a, away_n)):
        if plist:
            p = plist[0]
            bullets.append(f"{nm}: {p['name']} lidera a participação ofensiva ({_n(p.get('xg_per_match'))} xG e "
                           f"{_n(p.get('shots_per_match'), 1)} chutes por jogo; {_pct(p.get('p_goal'))} de chance de gol).")

    notes = [
        f"Baseado nos últimos {nh} jogos do mandante e {na} do visitante com chutes reais (Understat), contra a média de "
        f"{league.get('matches', 0)} jogos da liga; só jogos anteriores à partida entram.",
        "Força de ataque e defesa suavizadas para a média da liga (suavização bayesiana, 3 jogos fictícios).",
        "Cenários: gols do time em foco ×(1±d) e do adversário ×(1∓d), com d maior quando a amostra é menor; não são probabilidades igualmente prováveis.",
        "Gols: Poisson independente com λ = média da liga × ataque × defesa adversária × mando × goleiro; chutes: binomial negativa.",
        "Estimativas descritivas e experimentais: não são garantias nem modelo treinado.",
    ]
    if confidence == "low":
        notes.append("Amostra pequena (menos de 4 jogos de um dos times): leia as estimativas com cautela.")

    return {
        "available": True, "mode": "pre", "match_id": match["id"], "method": METHOD,
        "generated_at": datetime.utcnow().isoformat(),
        "teams": {"home": match["home"], "away": match["away"]},
        "sample": {"home_matches": nh, "away_matches": na, "league_matches": league.get("matches", 0)},
        "headline": {"text": headline, "favorite": favorite, "confidence": confidence},
        "estimates": {
            "expected_goals": {"home": round(lam_h, 2), "away": round(lam_a, 2), "total": round(lam_h + lam_a, 2)},
            "expected_shots": shots, "expected_shots_on_target": sot,
            "outcome": {k: round(probs[k], 4) for k in ("home", "draw", "away")},
            "over_2_5": round(probs["over_2_5"], 4), "btts": round(probs["btts"], 4),
            "strengths": {"home_attack": round(att_h, 3), "home_defense_weakness": round(def_h, 3),
                          "away_attack": round(att_a, 3), "away_defense_weakness": round(def_a, 3)},
            "sensitivity": sensitivity,
            "method": "Poisson (gols) + binomial negativa (chutes) + suavização bayesiana",
        },
        "defensive_weaknesses": {"home": weak_h, "away": weak_a},
        "shots_conceded": {"home": conceded(ah), "away": conceded(aa), "more": more, "text": conceded_text},
        "attack_sides": {"home": lanes_h, "away": lanes_a},
        "key_players": {"home": players_h, "away": players_a},
        "trends": {"home": trends_h, "away": trends_a, "h2h": _h2h_block(h2h, match["home"]["id"], home_n, away_n)},
        "factors": factors,
        "conclusion": {"text": headline, "bullets": bullets, "confidence": confidence, "favorite": favorite},
        "notes": notes,
    }


# --------------------------------------------------------------------------- relatório pós-jogo
GOAL_TOLERANCE = 1.0          # gols esperados por time: acerto se |esperado − real| < 1
TOTAL_GOAL_TOLERANCE = 1.5    # total de gols
EVEN_MARGIN = 1               # "jogo equilibrado": empate ou vitória por 1 gol
EVEN_SHOTS_GAP = 2            # "volume parecido de chutes cedidos": diferença de até 2 chutes
TOP_ZONES = 2                 # a zona fraca prevista vale se estiver entre as 2 que mais cederam xG


def actual_from_events(events: Sequence[Any], home_ids: Sequence[int], away_ids: Sequence[int], match_id: int,
                       home_score: int, away_score: int, own_zone: Any) -> Dict[str, Any]:
    """O que aconteceu na partida: chutes por time (``aggregate_team``), zona do defensor e jogadores.

    ``own_zone(event) -> (zona_de_ataque, zona_do_defensor)`` vem de ``shot_insights._own_zone``.
    """
    agg = {"home": aggregate_team(events, home_ids, [match_id]), "away": aggregate_team(events, away_ids, [match_id])}
    home_set = set(home_ids)
    def_zone_xg: Dict[str, Dict[str, float]] = {"home": {}, "away": {}}
    players: Dict[int, Dict[str, int]] = {}
    for e in events:
        if e.match_id != match_id or e.position is None or _is_own_goal(e):
            continue
        defender_side = "away" if e.team_id in home_set else "home"      # quem cedeu o chute
        zone = own_zone(e)[1]
        def_zone_xg[defender_side][zone] = def_zone_xg[defender_side].get(zone, 0.0) + _xg(e)
        pid = getattr(e, "player_id", None)
        if pid is not None:
            rec = players.setdefault(pid, {"shots": 0, "sot": 0, "goals": 0, "assists": 0})
            rec["shots"] += 1
            rec["sot"] += 1 if _on_target(e) else 0
            if _is_goal(e):
                rec["goals"] += 1
                assist = getattr(e, "secondary_player_id", None)
                if assist is not None:
                    players.setdefault(assist, {"shots": 0, "sot": 0, "goals": 0, "assists": 0})["assists"] += 1
    return {"score": {"home": home_score, "away": away_score}, "agg": agg, "def_zone_xg": def_zone_xg, "players": players}


def _lane_text(lane: str) -> str:
    return LANE_PREP.get(lane, lane)


def build_review(report: Dict[str, Any], actual: Dict[str, Any]) -> Dict[str, Any]:
    """Confronta as previsões do relatório pré-jogo com o que aconteceu (sem placar exato)."""
    home, away = report["teams"]["home"]["name"], report["teams"]["away"]["name"]
    names = {"home": home, "away": away}
    est = report["estimates"]
    hs, as_ = actual["score"]["home"], actual["score"]["away"]
    agg = actual["agg"]
    checks: List[Dict[str, Any]] = []

    def add(key: str, group: str, label: str, predicted: str, observed: str, hit: Optional[bool], detail: str = "") -> None:
        checks.append({"key": key, "group": group, "label": label, "predicted": predicted, "observed": observed,
                       "status": "na" if hit is None else ("hit" if hit else "miss"), "detail": detail})

    # ---- resultado ---------------------------------------------------------------------------------
    result = "home" if hs > as_ else ("away" if as_ > hs else "draw")
    fav = report["headline"]["favorite"]
    obs_result = f"{home} {hs}×{as_} {away} — " + ("empate" if result == "draw" else f"vitória do {names[result]}")
    if fav == "even":
        add("result", "Resultado", "Quem ganha", f"Equilíbrio (vitória {_pct(est['outcome']['home'])} / empate {_pct(est['outcome']['draw'])} / "
            f"vitória {_pct(est['outcome']['away'])})", obs_result, result == "draw" or abs(hs - as_) <= EVEN_MARGIN,
            "Equilíbrio vale se terminou empatado ou com 1 gol de diferença.")
    else:
        add("result", "Resultado", "Quem ganha", f"{names[fav]} favorito ({_pct(est['outcome'][fav])} de vitória)", obs_result,
            result == fav)

    # ---- gols --------------------------------------------------------------------------------------
    eg = est["expected_goals"]
    for side, goals in (("home", hs), ("away", as_)):
        add(f"goals_{side}", "Gols", f"Gols do {names[side]}", f"{_n(eg[side])} esperados", f"{goals}",
            abs(eg[side] - goals) < GOAL_TOLERANCE, "Acerto: diferença menor que 1 gol.")
    add("goals_total", "Gols", "Total de gols", f"{_n(eg['total'])} esperados", f"{hs + as_}",
        abs(eg["total"] - (hs + as_)) < TOTAL_GOAL_TOLERANCE, "Acerto: diferença menor que 1,5 gol.")
    over_pred = est["over_2_5"] >= 0.5
    add("over_2_5", "Gols", "Mais de 2,5 gols", f"{'Sim' if over_pred else 'Não'} ({_pct(est['over_2_5'])})",
        f"{'Sim' if hs + as_ >= 3 else 'Não'} ({hs + as_} gols)", over_pred == (hs + as_ >= 3))
    btts_pred = est["btts"] >= 0.5
    btts_real = hs > 0 and as_ > 0
    add("btts", "Gols", "Ambos marcam", f"{'Sim' if btts_pred else 'Não'} ({_pct(est['btts'])})",
        f"{'Sim' if btts_real else 'Não'} ({hs}×{as_})", btts_pred == btts_real)

    # ---- finalizações ------------------------------------------------------------------------------
    for key, label, field, real_key in (("shots", "Chutes", "expected_shots", "shots_for_total"),
                                        ("sot", "Chutes no alvo", "expected_shots_on_target", "sot_for_total")):
        for side in ("home", "away"):
            rng = est[field][side]
            real = int(agg[side][real_key])
            add(f"{key}_{side}", "Finalizações", f"{label} do {names[side]}",
                f"{_n(rng['mean'], 1)} (faixa {rng['low']}–{rng['high']})", f"{real}", rng["low"] <= real <= rng["high"],
                "Acerto: dentro da faixa de 10% a 90%.")
    conceded = {"home": int(agg["home"]["shots_against_total"]), "away": int(agg["away"]["shots_against_total"])}
    gap = conceded["home"] - conceded["away"]
    real_more = "home" if gap > 0 else ("away" if gap < 0 else "even")
    pred_more = report["shots_conceded"]["more"]
    pred_text = "Volume parecido" if pred_more == "even" else f"{names[pred_more]} cede mais"
    real_text = f"{home} {conceded['home']} × {conceded['away']} {away} chutes cedidos"
    add("conceded_more", "Finalizações", "Quem cede mais chutes", pred_text, real_text,
        (abs(gap) <= EVEN_SHOTS_GAP) if pred_more == "even" else (pred_more == real_more),
        "Volume parecido vale com até 2 chutes de diferença.")

    # ---- campo -------------------------------------------------------------------------------------
    for side in ("home", "away"):
        lanes = agg[side]["lane_for_total"]
        pred_lane = report["attack_sides"][side]["best"]
        if sum(lanes.values()) <= 0:
            add(f"lane_{side}", "Campo", f"Lado do ataque do {names[side]}", f"{_lane_text(pred_lane)}", "sem finalizações", None)
            continue
        real_lane = max(LANES, key=lambda l: lanes[l])
        add(f"lane_{side}", "Campo", f"Lado do ataque do {names[side]}", f"{_lane_text(pred_lane)}",
            f"{_lane_text(real_lane)} ({_n(100 * lanes[real_lane] / sum(lanes.values()), 0)}% do xG)", pred_lane == real_lane)
    for side in ("home", "away"):
        weak = (report["defensive_weaknesses"][side] or [None])[0]
        zones = sorted(actual["def_zone_xg"][side].items(), key=lambda kv: kv[1], reverse=True)
        if weak is None:
            continue
        if not zones:
            add(f"weak_{side}", "Campo", f"Zona fraca do {names[side]}", weak["label"], "não cedeu finalizações", None)
            continue
        top = [z for z, _ in zones[:TOP_ZONES]]
        add(f"weak_{side}", "Campo", f"Zona fraca do {names[side]}", weak["label"],
            ZONE_TITLE.get(zones[0][0], zones[0][0]) + f" ({_n(zones[0][1])} xG cedido)", weak["zone"] in top,
            "Acerto: a zona prevista está entre as 2 que mais cederam xG.")

    # ---- jogadores ---------------------------------------------------------------------------------
    players_out: Dict[str, List[Dict[str, Any]]] = {"home": [], "away": []}
    for side in ("home", "away"):
        for i, p in enumerate((report["key_players"][side] or [])[:3]):
            rec = actual["players"].get(p["player_id"], {"shots": 0, "sot": 0, "goals": 0, "assists": 0})
            hit = rec["goals"] + rec["assists"] >= 1
            players_out[side].append({
                "player_id": p["player_id"], "name": p["name"], "p_involvement": p.get("p_goal_involvement"),
                "shots": rec["shots"], "sot": rec["sot"], "goals": rec["goals"], "assists": rec["assists"], "hit": hit,
            })
            if i == 0:
                bits = [f"{rec['goals']} gol(s)", f"{rec['assists']} assistência(s)", f"{rec['shots']} chute(s)"]
                add(f"player_{side}", "Jogadores", f"Maior participação do {names[side]}: {p['name']}",
                    f"gol ou assistência ({_pct(p.get('p_goal_involvement'))})", ", ".join(bits), hit,
                    "Acerto: marcou ou deu assistência (quem não entrou em campo conta como erro).")

    scored = [c for c in checks if c["status"] != "na"]
    hits = sum(1 for c in scored if c["status"] == "hit")
    pct = round(100 * hits / len(scored)) if scored else 0
    right = [f"{c['label']}: previu {c['predicted']} e foi {c['observed']}" for c in scored if c["status"] == "hit"]
    wrong = [f"{c['label']}: previu {c['predicted']} e foi {c['observed']}" for c in scored if c["status"] == "miss"]
    return {
        "headline": f"A análise acertou {hits} de {len(scored)} previsões ({pct}%).",
        "hits": hits, "total": len(scored), "pct": pct, "final": {"home": hs, "away": as_},
        "xg": {"home": round(agg["home"]["xg_for_total"], 2), "away": round(agg["away"]["xg_for_total"], 2)},
        "checks": checks, "players": players_out, "right": right, "wrong": wrong,
        "caveat": "Um jogo só é um exemplo, não prova de qualidade do modelo: a taxa de acerto só diz algo olhando muitos jogos.",
    }


# --------------------------------------------------------------------------- banco
def generate_match_report(db: Any, m: Any, insights: Dict[str, Any]) -> Dict[str, Any]:
    """Relatório pré-jogo da partida ``m`` a partir de ``match_insights`` e dos chutes reais anteriores."""
    from app.repositories.repositories import MatchRepository
    from app.services.crests import resolve_crest
    from app.services.shot_insights import WINDOW, season_baseline
    from app.services.studio import _load_shot_events, _recent_match_ids, _team_ids_like

    base = {"available": False, "match_id": m.id, "method": METHOD}
    if not insights.get("available"):
        return {**base, "notes": insights.get("notes") or ["Sem chutes anteriores a esta partida para os dois times."]}

    home_ids, away_ids = _team_ids_like(db, m.home_team), _team_ids_like(db, m.away_team)
    home_recent = _recent_match_ids(db, home_ids, m.kickoff_time, WINDOW)
    away_recent = _recent_match_ids(db, away_ids, m.kickoff_time, WINDOW)
    home_events = _load_shot_events(db, home_recent)
    away_events = _load_shot_events(db, away_recent)
    agg = {"home": aggregate_team(home_events, home_ids, home_recent),
           "away": aggregate_team(away_events, away_ids, away_recent)}

    att_base, _, league_n = season_baseline(db, m.season_id, m.kickoff_time, home_events + away_events)
    lane_pm = {l: 0.0 for l in LANES}
    for zone, value in att_base.items():
        lane_pm[zone_lane(zone)] += value
    league = {"xg_per_team_match": sum(att_base.values()), "lane_xg_pm": lane_pm, "matches": league_n}

    h2h = None
    try:
        h2h = [{"home_id": g.home_team_id, "home_score": g.home_score, "away_score": g.away_score}
               for g in MatchRepository().head_to_head(db, m.home_team_id, m.away_team_id, limit=6)
               if g.id != m.id and (g.status or "").lower() == "finished"]
    except Exception:  # noqa: BLE001 — confrontos diretos são opcionais
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass

    def team(t: Any, tid: int) -> Dict[str, Any]:
        name = t.name if t else "?"
        return {"id": tid, "name": name, "logo_url": resolve_crest(name, t.logo_url if t else None)}

    match = {"id": m.id, "home": team(m.home_team, m.home_team_id), "away": team(m.away_team, m.away_team_id)}
    report = build_report(match, insights, agg, league, h2h)
    if (m.status or "").lower() == "finished" and m.home_score is not None and m.away_score is not None:
        # Partida encerrada: no lugar do relatório pré-jogo, confronta a previsão com o que aconteceu.
        from app.services.shot_insights import _own_zone

        actual = actual_from_events(_load_shot_events(db, [m.id]), home_ids, away_ids, m.id, m.home_score, m.away_score, _own_zone)
        return {
            "available": True, "mode": "post", "match_id": m.id, "method": METHOD, "generated_at": report["generated_at"],
            "teams": report["teams"], "sample": report["sample"], "review": build_review(report, actual),
            "notes": [
                "Previsões feitas só com jogos anteriores à partida (Understat) e comparadas com os chutes e o placar reais.",
                "Gols, 1×2, Over 2,5 e ambos marcam usam o placar oficial; chutes, lados e zonas usam os chutes registrados.",
            ],
        }
    return report
