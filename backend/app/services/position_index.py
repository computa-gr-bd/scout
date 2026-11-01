"""Índices por função: ofensivo (atacantes/meias), defensivo (defensores) e de goleiro.

Módulo **puro** (sem banco): recebe dicionários de estatísticas e devolve notas 0–100.
A leitura do banco fica em ``index_service.py``.

Como a nota é calculada
-----------------------
Cada índice é uma média ponderada de *componentes*; cada componente é uma média ponderada de
*métricas*. Cada métrica vira uma nota 0–100 de duas formas:

1. **Percentil entre os pares** (mesma função, mesma liga, ≥ ``min_minutes``) quando há pares
   suficientes (``MIN_PEERS``) — é a forma preferida porque se ajusta à liga.
2. **Âncoras** ``(lo, hi)`` (valores "ruim" → "excelente" típicos do futebol europeu) quando a
   amostra de pares é pequena (início de temporada, liga com poucos dados).

Taxas de sucesso (desarmes ganhos %, defesas %, ...) passam por *shrinkage* para a média típica,
para um goleiro com 3 chutes sofridos não ter "100% de defesas". Por fim a nota final é puxada
para 50 quando o jogador tem poucos minutos (``reliability``).

Não é um modelo treinado: é estatística descritiva transparente, igual ao índice ofensivo.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence

MIN_PEERS = 8
RELIABILITY_FULL_MINUTES = 1350.0   # ~15 jogos completos
RELIABILITY_FLOOR = 0.4
MIN_COVERAGE = 0.4                  # fração mínima do peso dos componentes com dado

ROLE_LABELS = {"GK": "Goleiro", "DEF": "Defensor", "MID": "Meio-campista", "ATT": "Atacante"}
INDEX_NAMES = {
    "GK": "Índice de goleiro ScoutVision",
    "DEF": "Índice defensivo ScoutVision",
    "MID": "Índice ofensivo ScoutVision",
    "ATT": "Índice ofensivo ScoutVision",
}


# --------------------------------------------------------------------------- função em campo
_TOKEN_ROLE = {
    "GK": "GK", "G": "GK",
    "D": "DEF", "DF": "DEF", "CB": "DEF", "LB": "DEF", "RB": "DEF", "WB": "DEF", "LWB": "DEF", "RWB": "DEF",
    "M": "MID", "MF": "MID", "CM": "MID", "DM": "MID", "AM": "MID", "LM": "MID", "RM": "MID", "CDM": "MID", "CAM": "MID",
    "F": "ATT", "FW": "ATT", "ST": "ATT", "CF": "ATT", "LW": "ATT", "RW": "ATT", "SS": "ATT",
}


def classify_role(position: Optional[str]) -> Optional[str]:
    """``GK`` | ``DEF`` | ``MID`` | ``ATT`` a partir de posições do Understat / FBref / football-data.

    Understat usa siglas separadas por espaço ("F M S", o ``S`` é reserva e é ignorado);
    FBref usa "DF,MF"; football-data usa palavras ("Centre-Back", "Offence").
    Com várias posições vale a primeira (a principal).
    """
    if not position:
        return None
    text = str(position).strip()
    low = text.lower()
    if "goalkeeper" in low or "keeper" in low:
        return "GK"
    if "back" in low or "defen" in low:
        return "DEF"
    if "midfield" in low:
        return "MID"
    if any(w in low for w in ("offence", "forward", "winger", "striker", "attack")):
        return "ATT"
    for token in re.split(r"[\s,/;-]+", text.upper()):
        if token == "S":  # reserva (Understat)
            continue
        role = _TOKEN_ROLE.get(token)
        if role:
            return role
    return None


# --------------------------------------------------------------------------- definição das métricas
@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    unit: str                 # "", "%", "/90"
    lo: float                 # âncora "fraco"
    hi: float                 # âncora "excelente"
    invert: bool = False      # menor é melhor
    weight: float = 1.0
    decimals: int = 2


@dataclass(frozen=True)
class ComponentDef:
    key: str
    label: str
    weight: float
    metrics: Sequence[MetricDef]
    hint: str = ""


def _m(key, label, unit, lo, hi, invert=False, weight=1.0, decimals=2) -> MetricDef:
    return MetricDef(key, label, unit, lo, hi, invert, weight, decimals)


DEF_COMPONENTS: List[ComponentDef] = [
    ComponentDef("duels", "Desarmes e interceptações", 0.25, [
        _m("tkl_int_p90", "Desarmes + interc.", "/90", 1.5, 5.0, weight=2),
        _m("tackle_win_pct", "Desarmes ganhos", "%", 50, 75, decimals=1),
        _m("dribbled_past_p90", "Driblado", "/90", 0.2, 1.3, invert=True),
    ], "Quanto o defensor rouba a bola e ganha o 1x1."),
    ComponentDef("aerial", "Jogo aéreo", 0.20, [
        _m("aerials_won_p90", "Aéreos ganhos", "/90", 0.5, 4.5, weight=2),
        _m("aerial_win_pct", "Aproveitamento aéreo", "%", 40, 75, decimals=1),
    ], "Disputas pelo alto, bolas paradas e cruzamentos."),
    ComponentDef("box", "Proteção da área", 0.20, [
        _m("clearances_p90", "Cortes", "/90", 1.0, 6.0),
        _m("blocks_p90", "Bloqueios", "/90", 0.3, 2.2),
        _m("blocked_shots_p90", "Chutes bloqueados", "/90", 0.1, 1.2),
    ], "Corta, bloqueia e se joga na frente da finalização."),
    ComponentDef("buildup", "Construção e progressão", 0.20, [
        _m("prog_passes_p90", "Passes progressivos", "/90", 2.0, 9.0, weight=1.5),
        _m("prog_carries_p90", "Conduções progressivas", "/90", 0.3, 3.0),
        _m("pass_cmp_pct", "Precisão de passe", "%", 72, 92, decimals=1),
    ], "Quanto o defensor leva o time para frente com a bola."),
    ComponentDef("discipline", "Disciplina", 0.10, [
        _m("fouls_p90", "Faltas", "/90", 0.5, 1.8, invert=True),
        _m("cards_p90", "Cartões (V=1, Vm=2)", "/90", 0.05, 0.35, invert=True),
        _m("errors_p90", "Erros que viram chute", "/90", 0.0, 0.12, invert=True, decimals=3),
    ], "Menos faltas, cartões e erros comprometedores = nota maior."),
    ComponentDef("availability", "Regularidade", 0.05, [
        _m("availability_pct", "Minutos / jogos", "%", 50, 100, decimals=0),
    ], "Quanto joga por partida em que entra."),
]

GK_COMPONENTS: List[ComponentDef] = [
    ComponentDef("shot_stopping", "Defesas e gols evitados", 0.40, [
        _m("psxg_diff_p90", "Gols evitados (PSxG − GA)", "/90", -0.25, 0.25, weight=2, decimals=2),
        _m("save_pct", "Defesas (% dos chutes no alvo)", "%", 62, 78, decimals=1),
    ], "Quanto o goleiro evita acima do esperado pela qualidade dos chutes."),
    ComponentDef("goals_against", "Gols sofridos", 0.20, [
        _m("ga_p90", "Gols sofridos", "/90", 0.8, 1.9, invert=True),
        _m("clean_sheet_pct", "Jogos sem sofrer gol", "%", 10, 45, decimals=0),
    ], "Resultado coletivo (depende também da defesa à frente)."),
    ComponentDef("area_control", "Cruzamentos e saídas", 0.15, [
        _m("cross_stop_pct", "Cruzamentos interceptados", "%", 3, 12, decimals=1),
        _m("opa_p90", "Ações fora da área", "/90", 0.2, 1.8),
    ], "Domínio da área e atuação como líbero."),
    ComponentDef("distribution", "Jogo com os pés", 0.15, [
        _m("launched_cmp_pct", "Lançamentos certos", "%", 35, 65, decimals=1),
        _m("pass_cmp_pct", "Precisão de passe", "%", 60, 85, decimals=1),
    ], "Qualidade na saída de bola."),
    ComponentDef("penalties", "Pênaltis", 0.05, [
        _m("pk_save_pct", "Pênaltis defendidos", "%", 0, 35, decimals=0),
    ], "Amostra pequena: entra com peso baixo e muito suavizada."),
    ComponentDef("availability", "Regularidade", 0.05, [
        _m("availability_pct", "Minutos / jogos", "%", 70, 100, decimals=0),
    ], "Quanto joga por partida em que entra."),
]

COMPONENTS: Dict[str, List[ComponentDef]] = {"DEF": DEF_COMPONENTS, "GK": GK_COMPONENTS}


# --------------------------------------------------------------------------- métricas a partir do dicionário "plano"
def _num(flat: Mapping[str, Any], *keys: str) -> Optional[float]:
    for key in keys:
        value = flat.get(key)
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number == number:  # não-NaN
            return number
    return None


def _shrunk_pct(success: Optional[float], total: Optional[float], prior: float, k: float) -> Optional[float]:
    """Taxa de sucesso (em %) suavizada em direção a ``prior`` (0–1) com ``k`` tentativas fictícias."""
    if success is None or total is None or total <= 0:
        return None
    return 100.0 * (success + k * prior) / (total + k)


def _p90(value: Optional[float], n90: float) -> Optional[float]:
    return None if value is None or n90 <= 0 else value / n90


def compute_metrics(role: str, flat: Mapping[str, Any]) -> Dict[str, Optional[float]]:
    """Valores (não normalizados) de todas as métricas da função, ``None`` quando não há dado."""
    minutes = _num(flat, "minutes_played") or 0.0
    n90 = minutes / 90.0
    matches = _num(flat, "matches_played") or 0.0
    out: Dict[str, Optional[float]] = {}

    availability = None
    if matches > 0 and minutes > 0:
        availability = max(0.0, min(100.0, 100.0 * minutes / (matches * 90.0)))
    out["availability_pct"] = availability

    if role == "DEF":
        tkl_int = _num(flat, "tkl_plus_int")
        if tkl_int is None:
            tackles, inter = _num(flat, "tkl_won", "tackles"), _num(flat, "interceptions")
            tkl_int = (tackles or 0) + (inter or 0) if (tackles is not None or inter is not None) else None
        out["tkl_int_p90"] = _p90(tkl_int, n90)
        out["tackle_win_pct"] = _shrunk_pct(_num(flat, "tkl_won"), _num(flat, "tkl"), 0.62, 10)
        out["dribbled_past_p90"] = _p90(_num(flat, "dribbled_past"), n90)
        won, lost = _num(flat, "aerials_won"), _num(flat, "aerials_lost")
        out["aerials_won_p90"] = _p90(won, n90) if (won or lost) else None
        out["aerial_win_pct"] = _shrunk_pct(won, (won or 0) + (lost or 0), 0.5, 10) if (won or lost) else None
        out["clearances_p90"] = _p90(_num(flat, "clearances"), n90)
        out["blocks_p90"] = _p90(_num(flat, "blocks"), n90)
        out["blocked_shots_p90"] = _p90(_num(flat, "blocks_shots"), n90)
        out["prog_passes_p90"] = _p90(_num(flat, "progressive_passes"), n90)
        out["prog_carries_p90"] = _p90(_num(flat, "progressive_carries"), n90)
        out["pass_cmp_pct"] = _shrunk_pct(_num(flat, "pass_cmp"), _num(flat, "pass_att"), 0.80, 30)
        out["fouls_p90"] = _p90(_num(flat, "fouls", "fouls_committed"), n90)
        yellow, red = _num(flat, "yellow_cards"), _num(flat, "red_cards")
        out["cards_p90"] = _p90((yellow or 0) + 2 * (red or 0), n90) if (yellow is not None or red is not None) else None
        out["errors_p90"] = _p90(_num(flat, "errors"), n90)
    elif role == "GK":
        saves, sota, ga = _num(flat, "gk_saves"), _num(flat, "gk_sota"), _num(flat, "gk_ga")
        psxg = _num(flat, "gk_psxg")
        out["save_pct"] = _shrunk_pct(saves, sota, 0.70, 20)
        out["psxg_diff_p90"] = _p90(psxg - ga, n90) if (psxg is not None and ga is not None) else None
        out["ga_p90"] = _p90(ga, n90)
        cs = _num(flat, "gk_clean_sheets")
        out["clean_sheet_pct"] = 100.0 * cs / matches if (cs is not None and matches > 0) else None
        out["cross_stop_pct"] = _shrunk_pct(_num(flat, "gk_crosses_stopped"), _num(flat, "gk_crosses_opp"), 0.075, 20)
        out["opa_p90"] = _p90(_num(flat, "gk_opa"), n90)
        out["launched_cmp_pct"] = _shrunk_pct(_num(flat, "gk_launched_cmp"), _num(flat, "gk_launched_att"), 0.50, 20)
        out["pass_cmp_pct"] = _shrunk_pct(_num(flat, "pass_cmp"), _num(flat, "pass_att"), 0.70, 40)
        out["pk_save_pct"] = _shrunk_pct(_num(flat, "gk_pk_saved"), _num(flat, "gk_pk_att"), 0.20, 8)
    return out


# --------------------------------------------------------------------------- nota 0–100
def anchor_score(value: float, lo: float, hi: float, invert: bool = False) -> float:
    if hi == lo:
        return 50.0
    score = 100.0 * (value - lo) / (hi - lo)
    score = max(0.0, min(100.0, score))
    return 100.0 - score if invert else score


def percentile_score(value: float, peers: Sequence[float], invert: bool = False) -> float:
    """Percentil (0–100) do valor entre os pares, contando empates pela metade."""
    if not peers:
        return 50.0
    below = sum(1 for p in peers if p < value)
    equal = sum(1 for p in peers if p == value)
    pct = 100.0 * (below + 0.5 * equal) / len(peers)
    return 100.0 - pct if invert else pct


def reliability(minutes: float) -> float:
    return max(RELIABILITY_FLOOR, min(1.0, minutes / RELIABILITY_FULL_MINUTES))


def _round(value: Optional[float], decimals: int) -> Optional[float]:
    return None if value is None else round(value, decimals)


def score_index(
    role: str,
    metrics: Mapping[str, Optional[float]],
    peer_metrics: Sequence[Mapping[str, Optional[float]]] = (),
    minutes: float = 0.0,
) -> Dict[str, Any]:
    """Índice 0–100 da função + decomposição por componente e métrica.

    ``peer_metrics``: resultado de ``compute_metrics`` de cada par (mesma função/liga).
    """
    components = COMPONENTS.get(role)
    if components is None:
        return {"available": False, "role": role, "reason": "Índice desta função usa o painel ofensivo."}

    comp_out: List[Dict[str, Any]] = []
    used_methods: set[str] = set()
    weight_total = 0.0
    weighted_sum = 0.0
    for comp in components:
        m_out: List[Dict[str, Any]] = []
        m_weight = 0.0
        m_sum = 0.0
        for md in comp.metrics:
            value = metrics.get(md.key)
            peer_values = [p[md.key] for p in peer_metrics if p.get(md.key) is not None]
            entry: Dict[str, Any] = {
                "key": md.key, "label": md.label, "unit": md.unit,
                "value": _round(value, md.decimals), "score": None,
                "league_avg": _round(sum(peer_values) / len(peer_values), md.decimals) if peer_values else None,
                "higher_is_better": not md.invert,
            }
            if value is not None:
                if len(peer_values) >= MIN_PEERS:
                    score, method = percentile_score(value, peer_values, md.invert), "percentile"
                else:
                    score, method = anchor_score(value, md.lo, md.hi, md.invert), "anchor"
                used_methods.add(method)
                entry["score"] = round(score, 1)
                entry["method"] = method
                m_weight += md.weight
                m_sum += score * md.weight
            m_out.append(entry)
        comp_score = (m_sum / m_weight) if m_weight > 0 else None
        comp_out.append({
            "key": comp.key, "label": comp.label, "weight": comp.weight, "hint": comp.hint,
            "score": _round(comp_score, 1), "metrics": m_out,
        })
        if comp_score is not None:
            weight_total += comp.weight
            weighted_sum += comp_score * comp.weight

    coverage = weight_total / sum(c.weight for c in components)
    rel = reliability(minutes)
    base = {
        "available": False, "role": role, "role_label": ROLE_LABELS.get(role, role),
        "name": INDEX_NAMES.get(role), "components": comp_out,
        "coverage": round(coverage, 2), "reliability": round(rel, 2),
        "peers": len(peer_metrics),
        "method": "percentile" if used_methods == {"percentile"} else ("anchor" if used_methods == {"anchor"} else "mixed"),
    }
    if coverage < MIN_COVERAGE or weight_total <= 0:
        return {**base, "index": None, "raw_index": None,
                "reason": "Dados insuficientes: rode a sincronização do FBref (SoccerData) para esta liga."}
    raw = weighted_sum / weight_total
    shrunk = 50.0 + (raw - 50.0) * rel
    return {**base, "available": True, "raw_index": round(raw, 1), "index": int(round(shrunk))}


# --------------------------------------------------------------------------- insumos a partir de PlayerStatistics
STAT_COLUMNS = (
    "matches_played", "minutes_played", "starts", "goals", "assists", "tackles", "interceptions",
    "clearances", "aerials_won", "aerials_lost", "passes", "passes_completed", "key_passes",
    "fouls_committed", "crosses",
)


def flatten_stat(columns: Mapping[str, Any], supplemental: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Une as colunas de ``PlayerStatistics`` com os totais do FBref (``supplemental_stats.soccerdata``).

    Os totais do SoccerData têm prioridade; ``tackles`` da tabela vem de TklW (desarmes ganhos).
    """
    flat: Dict[str, Any] = {k: columns.get(k) for k in STAT_COLUMNS if columns.get(k) is not None}
    provider = (supplemental or {}).get("soccerdata") if isinstance(supplemental, Mapping) else None
    if isinstance(provider, Mapping):
        for key, value in provider.items():
            if value is not None:
                flat[key] = value
    # Colunas que só têm o equivalente genérico.
    if "pass_cmp" not in flat and flat.get("passes_completed"):
        flat["pass_cmp"], flat["pass_att"] = flat["passes_completed"], flat.get("passes")
    return flat


# --------------------------------------------------------------------------- goleiro adversário nas previsões
LEAGUE_SAVE_PCT = 0.70
GK_FACTOR_PRIOR_SHOTS = 40.0
GK_FACTOR_BOUNDS = (0.85, 1.15)


def gk_goal_factor(flat: Mapping[str, Any], league_save_pct: float = LEAGUE_SAVE_PCT) -> Optional[Dict[str, float]]:
    """Fator multiplicativo na chance de GOL de quem enfrenta este goleiro (1,0 = goleiro médio).

    Usa a taxa de gols sofridos por chute no alvo, suavizada para a média da liga
    (``GK_FACTOR_PRIOR_SHOTS`` chutes fictícios) e limitada a ±15%. ``None`` sem dados.
    """
    sota, saves = _num(flat, "gk_sota"), _num(flat, "gk_saves")
    if not sota or saves is None or sota < 5:
        return None
    save_rate = (saves + GK_FACTOR_PRIOR_SHOTS * league_save_pct) / (sota + GK_FACTOR_PRIOR_SHOTS)
    base_conceded = max(1e-6, 1.0 - league_save_pct)
    ratio = (1.0 - save_rate) / base_conceded
    lo, hi = GK_FACTOR_BOUNDS
    return {"factor": round(max(lo, min(hi, ratio)), 3), "save_pct": round(100 * saves / sota, 1), "shots_on_target_faced": sota}


def reduce_peer_metrics(role: str, flats: Iterable[Mapping[str, Any]], min_minutes: float) -> List[Dict[str, Optional[float]]]:
    return [
        compute_metrics(role, flat) for flat in flats
        if (_num(flat, "minutes_played") or 0) >= min_minutes
    ]


__all__ = [
    "classify_role", "compute_metrics", "score_index", "flatten_stat", "gk_goal_factor",
    "reduce_peer_metrics", "anchor_score", "percentile_score", "reliability",
    "ROLE_LABELS", "INDEX_NAMES", "COMPONENTS", "MIN_PEERS",
]
