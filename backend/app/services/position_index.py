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


def infer_role(*positions: Optional[str], flat: Optional[Mapping[str, Any]] = None) -> Optional[str]:
    """Função do jogador: a primeira posição reconhecível; senão pelas estatísticas (goleiro tem defesas).

    ``positions`` em ordem de confiança (ex.: ``Player.position``, posição do Understat em
    ``recent_form``, posição da escalação).
    """
    for position in positions:
        role = classify_role(position)
        if role:
            return role
    if flat and ((_num(flat, "gk_sota") or 0) > 0 or (_num(flat, "d_gk_matches") or 0) > 0
                 or (_num(flat, "m_gk_matches") or 0) > 0):
        return "GK"
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
    ComponentDef("onpitch", "Defesa com ele em campo", 0.30, [
        _m("onpitch_xga_p90", "xG sofrido pelo time / 90", "/90", 0.8, 1.8, invert=True, weight=2),
        _m("onpitch_ga_p90", "Gols sofridos pelo time / 90", "/90", 0.7, 2.0, invert=True),
        _m("onpitch_shots_p90", "Chutes sofridos pelo time / 90", "/90", 8.0, 15.0, invert=True),
    ], "Quanto o time sofre enquanto ele joga (chutes do Understat ou placar dos jogos). Indicador coletivo."),
    ComponentDef("duels", "Desarmes e interceptações", 0.25, [
        _m("tkl_int_p90", "Desarmes + interc.", "/90", 1.5, 5.0),
    ], "Quanto o defensor rouba a bola."),
    ComponentDef("buildup", "Construção e criação", 0.25, [
        _m("xg_buildup_p90", "xGBuildup", "/90", 0.1, 0.7, weight=1.5),
        _m("xg_chain_p90", "xGChain", "/90", 0.2, 1.0),
        _m("key_passes_p90", "Passes-chave", "/90", 0.1, 1.2),
    ], "Participação na construção das jogadas (Understat)."),
    ComponentDef("discipline", "Disciplina", 0.12, [
        _m("fouls_p90", "Faltas", "/90", 0.5, 1.8, invert=True),
        _m("cards_p90", "Cartões (V=1, Vm=2)", "/90", 0.05, 0.35, invert=True),
    ], "Menos faltas e cartões = nota maior."),
    ComponentDef("availability", "Regularidade", 0.08, [
        _m("availability_pct", "Minutos / jogos", "%", 50, 100, decimals=0),
    ], "Quanto joga por partida em que entra."),
]

GK_COMPONENTS: List[ComponentDef] = [
    ComponentDef("shot_stopping", "Defesas e gols evitados", 0.55, [
        _m("psxg_diff_p90", "Gols evitados (esperado − gols)", "/90", -0.25, 0.25, weight=2, decimals=2),
        _m("save_pct", "Defesas (% dos chutes no alvo)", "%", 62, 78, decimals=1),
    ], "Quanto o goleiro evita acima do esperado pela qualidade (ou, sem PSxG, pela média da liga) dos chutes."),
    ComponentDef("goals_against", "Gols sofridos", 0.25, [
        _m("ga_p90", "Gols sofridos", "/90", 0.8, 1.9, invert=True),
        _m("clean_sheet_pct", "Jogos sem sofrer gol", "%", 10, 45, decimals=0),
    ], "Resultado coletivo (depende também da defesa à frente)."),
    ComponentDef("penalties", "Pênaltis", 0.10, [
        _m("pk_save_pct", "Pênaltis defendidos", "%", 0, 35, decimals=0),
    ], "Amostra pequena: entra com peso baixo e muito suavizada."),
    ComponentDef("availability", "Regularidade", 0.10, [
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


def gk_totals(flat: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """Totais de goleiro, por ordem de preferência:

    1. FBref (``gk_*``). Se o FBref veio sem PSxG (a Opta cortou as estatísticas avançadas),
       o par "xG no alvo − gols" é completado com o derivado dos chutes (``d_gk_xgot`` / ``d_gk_ga``);
    2. derivados dos chutes do Understat (``d_gk_*``): ``xgot`` faz o papel do PSxG;
    3. somas das estatísticas por partida gravadas no banco (``m_gk_*``, ESPN): sem PSxG, mas
       dá defesas, gols sofridos, chutes enfrentados e jogos sem sofrer gol.

    ``xg_ga`` / ``xg_minutes`` são os gols e os minutos que acompanham o ``psxg`` no cálculo dos gols evitados.
    """
    sota = _num(flat, "gk_sota")
    d_matches = _num(flat, "d_gk_matches")
    if sota:
        psxg, xg_ga = _num(flat, "gk_psxg"), _num(flat, "gk_ga")
        minutes = _num(flat, "minutes_played") or 0.0
        xg_minutes = minutes
        if psxg is None and d_matches and _num(flat, "d_gk_xgot") is not None and _num(flat, "d_gk_ga") is not None:
            psxg, xg_ga = _num(flat, "d_gk_xgot"), _num(flat, "d_gk_ga")
            xg_minutes = _num(flat, "d_gk_minutes") or d_matches * 90.0
        return {"source": "fbref", "saves": _num(flat, "gk_saves"), "sota": sota, "ga": _num(flat, "gk_ga"),
                "psxg": psxg, "xg_ga": xg_ga, "xg_minutes": xg_minutes, "cs": _num(flat, "gk_clean_sheets"),
                "minutes": minutes, "matches": _num(flat, "matches_played") or 0.0}
    if d_matches:
        minutes = _num(flat, "d_gk_minutes") or d_matches * 90.0
        return {"source": "derived", "saves": _num(flat, "d_gk_saves"), "sota": _num(flat, "d_gk_sota"),
                "ga": _num(flat, "d_gk_ga"), "psxg": _num(flat, "d_gk_xgot"), "xg_ga": _num(flat, "d_gk_ga"),
                "xg_minutes": minutes, "cs": _num(flat, "d_gk_clean_sheets"),
                "minutes": minutes, "matches": d_matches}
    m_matches = _num(flat, "m_gk_matches")
    if m_matches:
        minutes = _num(flat, "m_gk_minutes") or m_matches * 90.0
        return {"source": "match_stats", "saves": _num(flat, "m_gk_saves"), "sota": _num(flat, "m_gk_sota"),
                "ga": _num(flat, "m_gk_ga"), "psxg": None, "xg_ga": None, "xg_minutes": minutes,
                "cs": _num(flat, "m_gk_clean_sheets"), "minutes": minutes, "matches": m_matches}
    return None


def compute_metrics(role: str, flat: Mapping[str, Any],
                    league_save_pct: Optional[float] = None) -> Dict[str, Optional[float]]:
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
        out["fouls_p90"] = _p90(_num(flat, "fouls", "fouls_committed"), n90)
        yellow, red = _num(flat, "yellow_cards", "us_yellow"), _num(flat, "red_cards", "us_red")
        out["cards_p90"] = _p90((yellow or 0) + 2 * (red or 0), n90) if (yellow is not None or red is not None) else None
        # Understat (cobre todos os jogadores) e "em campo" derivado dos chutes.
        out["xg_buildup_p90"] = _p90(_num(flat, "us_xg_buildup"), n90)
        out["xg_chain_p90"] = _p90(_num(flat, "us_xg_chain"), n90)
        out["key_passes_p90"] = _p90(_num(flat, "key_passes"), n90)
        onp = _num(flat, "d_onp_90s")
        if onp and onp >= 3.0:
            out["onpitch_xga_p90"] = (_num(flat, "d_onp_xga") or 0) / onp
            out["onpitch_ga_p90"] = (_num(flat, "d_onp_ga") or 0) / onp
            out["onpitch_shots_p90"] = (_num(flat, "d_onp_shots_against") or 0) / onp
        else:
            # Sem estatística derivada dos chutes: usa o placar / xG / chutes dos jogos gravados no banco.
            m_onp = _num(flat, "m_onp_90s")
            if m_onp and m_onp >= 3.0:
                out["onpitch_ga_p90"] = (_num(flat, "m_onp_ga") or 0) / m_onp
            m_xga_90s = _num(flat, "m_onp_xga_90s")
            if m_xga_90s and m_xga_90s >= 3.0:
                out["onpitch_xga_p90"] = (_num(flat, "m_onp_xga") or 0) / m_xga_90s
            m_shots_90s = _num(flat, "m_onp_shots_90s")
            if m_shots_90s and m_shots_90s >= 3.0:
                out["onpitch_shots_p90"] = (_num(flat, "m_onp_shots") or 0) / m_shots_90s
    elif role == "GK":
        gk = gk_totals(flat)
        if gk is not None:
            gk_n90 = gk["minutes"] / 90.0
            gk_matches = gk["matches"]
            saves, sota, ga, psxg = gk["saves"], gk["sota"], gk["ga"], gk["psxg"]
            out["save_pct"] = _shrunk_pct(saves, sota, 0.70, 20)
            xg_ga, xg_n90 = gk.get("xg_ga"), (gk.get("xg_minutes") or gk["minutes"]) / 90.0
            out["psxg_diff_p90"] = _p90(psxg - xg_ga, xg_n90) if (psxg is not None and xg_ga is not None) else None
            if out["psxg_diff_p90"] is None and saves is not None and sota:
                # Sem PSxG/xG no alvo: "gols evitados" ESTIMADO pela média da liga.
                #   esperado_defesas = chutes_no_alvo × %_defesa_da_liga
                #   gols_evitados    = defesas − esperado_defesas      (= gols esperados − gols sofridos)
                #   por 90           = gols_evitados ÷ (minutos ÷ 90)
                # Positivo = defendeu mais que o goleiro médio da liga diante do mesmo número de chutes.
                league_pct = league_save_pct if league_save_pct else LEAGUE_SAVE_PCT
                out["psxg_diff_p90"] = _p90(saves - sota * league_pct, gk_n90)
                out["psxg_diff_estimated"] = 1.0
                out["psxg_league_save_pct"] = round(100.0 * league_pct, 1)
            out["ga_p90"] = _p90(ga, gk_n90)
            cs = gk["cs"]
            out["clean_sheet_pct"] = 100.0 * cs / gk_matches if (cs is not None and gk_matches > 0) else None
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


# Colunas de contagem que o banco preenche com 0 quando a fonte não tem o dado (ex.: Understat não
# traz cortes/aéreos/faltas). Um defensor/goleiro de temporada inteira nunca tem 0 de verdade nelas:
# 0 = "desconhecido", e não pode virar nota péssima.
UNKNOWN_WHEN_ZERO = frozenset({
    "tackles", "interceptions", "clearances", "aerials_won", "aerials_lost", "passes",
    "passes_completed", "fouls_committed", "crosses",
})


def flatten_stat(columns: Mapping[str, Any], supplemental: Optional[Mapping[str, Any]],
                 recent_form: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Une, em ordem de prioridade crescente: colunas de ``PlayerStatistics`` → extras do Understat
    (``recent_form``) → estatísticas derivadas dos chutes (prefixo ``d_``) → totais do FBref.

    Colunas em 0 listadas em ``UNKNOWN_WHEN_ZERO`` são tratadas como ausentes.
    """
    flat: Dict[str, Any] = {}
    for key in STAT_COLUMNS:
        value = columns.get(key)
        if value is None or (key in UNKNOWN_WHEN_ZERO and not value):
            continue
        flat[key] = value
    if isinstance(recent_form, Mapping):
        for src, dst in (("xg_buildup", "us_xg_buildup"), ("xg_chain", "us_xg_chain"),
                         ("yellow_cards", "us_yellow"), ("red_cards", "us_red")):
            if recent_form.get(src) is not None:
                flat[dst] = recent_form[src]
    if isinstance(supplemental, Mapping):
        derived = supplemental.get("derived")
        if isinstance(derived, Mapping):
            for key, value in derived.items():
                if value is not None:
                    flat[f"d_{key}"] = value
        provider = supplemental.get("soccerdata")
        if isinstance(provider, Mapping):
            for key, value in provider.items():
                if value is not None:
                    flat[key] = value
    if "pass_cmp" not in flat and flat.get("passes_completed"):
        flat["pass_cmp"], flat["pass_att"] = flat["passes_completed"], flat.get("passes")
    return flat


# --------------------------------------------------------------------------- totais das partidas gravadas no banco
MATCH_SUM_FIELDS = (
    "tackles", "interceptions", "fouls_committed", "fouls_suffered", "passes", "passes_completed",
    "key_passes", "duels", "duels_won", "yellow", "red", "shots", "shots_on_target",
)
MATCH_COVERAGE_MIN = 0.8   # fração mínima dos jogos da temporada com registro para usar as somas


def _f(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number else 0.0


def aggregate_match_rows(rows: Iterable[Mapping[str, Any]]) -> Dict[str, float]:
    """Soma as linhas por partida (``PlayerMatchStatistics`` + placar/estatística do time) de UM jogador.

    Cada linha: ``minutes, is_starter, position, tackles, interceptions, fouls_committed, fouls_suffered,
    passes, passes_completed, key_passes, duels, duels_won, yellow, red, saves, goals_conceded,
    shots_faced, team_ga, team_xga, opp_shots``. Retorna chaves com prefixo ``m_``:

    * ``m_matches`` / ``m_<campo>``: jogos com participação e soma de cada contagem;
    * ``m_gk_*``: jogos de goleiro, defesas, gols sofridos, chutes no alvo enfrentados, minutos, jogos sem sofrer gol.
      Chute no alvo enfrentado = defesas + gols sofridos quando a fonte manda ``shots_faced`` zerado;
    * ``m_onp_*``: o que o time sofreu enquanto o jogador esteve em campo (placar, xG e chutes), em "jogos de 90'".
    Função pura.
    """
    out: Dict[str, float] = {}

    def add(key: str, value: float) -> None:
        out[key] = out.get(key, 0.0) + value

    for r in rows:
        minutes = _f(r.get("minutes"))
        starter = bool(r.get("is_starter"))
        counts = {f: _f(r.get(f)) for f in MATCH_SUM_FIELDS}
        saves, conceded, faced = _f(r.get("saves")), _f(r.get("goals_conceded")), _f(r.get("shots_faced"))
        is_gk_row = classify_role(r.get("position")) == "GK"
        played = starter or minutes > 0 or any(v > 0 for v in counts.values()) or saves > 0 or faced > 0
        if not played:
            continue
        add("m_matches", 1.0)
        for field, value in counts.items():
            add(f"m_{field}", value)
        if is_gk_row or saves > 0 or faced > 0:
            sota = faced if faced > 0 else saves + conceded
            gk_minutes = minutes if minutes > 0 else (90.0 if starter else 45.0)
            add("m_gk_matches", 1.0)
            add("m_gk_minutes", min(gk_minutes, 120.0))
            add("m_gk_saves", saves)
            add("m_gk_ga", conceded)
            add("m_gk_sota", sota)
            add("m_gk_clean_sheets", 1.0 if conceded == 0 and r.get("team_ga") in (None, 0) else 0.0)
            continue
        w = min(minutes, 90.0) / 90.0 if minutes > 0 else (1.0 if starter else 0.0)
        if w <= 0:
            continue
        team_ga = r.get("team_ga")
        if team_ga is not None:
            add("m_onp_90s", w)
            add("m_onp_ga", _f(team_ga) * w)
        if _f(r.get("team_xga")) > 0:
            add("m_onp_xga_90s", w)
            add("m_onp_xga", _f(r.get("team_xga")) * w)
        if _f(r.get("opp_shots")) > 0:
            add("m_onp_shots_90s", w)
            add("m_onp_shots", _f(r.get("opp_shots")) * w)
    return out


def apply_match_totals(flat: Dict[str, Any], totals: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """Completa ``flat`` com as somas por partida **sem sobrescrever** FBref/SoccerData/colunas da temporada.

    Contagens de jogador de linha só entram se as partidas gravadas cobrem ≥ 80% dos jogos da temporada
    (senão o "por 90" ficaria subestimado) e se a soma não é zero (0 = fonte sem o dado). As chaves
    ``m_gk_*`` / ``m_onp_*`` entram sempre; ``gk_totals`` e ``compute_metrics`` só as usam como último recurso.
    """
    if not totals:
        return flat
    for key, value in totals.items():
        if key.startswith(("m_gk_", "m_onp_")) and value is not None:
            flat[key] = value
    matches = _f(totals.get("m_matches"))
    season_matches = _f(flat.get("matches_played"))
    covered = matches > 0 and (season_matches <= 0 or matches >= MATCH_COVERAGE_MIN * season_matches)
    if not covered:
        return flat
    flat["m_matches"] = matches
    for src, dst in (("tackles", "tackles"), ("interceptions", "interceptions"),
                     ("fouls_committed", "fouls_committed"), ("passes", "passes"),
                     ("passes_completed", "passes_completed"), ("key_passes", "key_passes")):
        value = _f(totals.get(f"m_{src}"))
        if value > 0 and not flat.get(dst):
            flat[dst] = value
    yellow, red = _f(totals.get("m_yellow")), _f(totals.get("m_red"))
    if (yellow or red) and "us_yellow" not in flat and "yellow_cards" not in flat:
        flat["us_yellow"], flat["us_red"] = yellow, red
    if "pass_cmp" not in flat and flat.get("passes_completed"):
        flat["pass_cmp"], flat["pass_att"] = flat["passes_completed"], flat.get("passes")
    return flat


def complementary_from_totals(totals: Optional[Mapping[str, Any]], matches_played: Optional[float]) -> Dict[str, float]:
    """Estatísticas complementares do jogador de linha vindas das partidas gravadas no banco (ESPN).

    Só campos que a fonte realmente informa (chutes, chutes no alvo, faltas, cartões); o zero aqui é um zero de
    verdade. Exige cobertura ≥ 80% dos jogos da temporada. Chaves iguais às da tela (``yellow_cards`` etc.).
    """
    if not totals:
        return {}
    matches, season = _f(totals.get("m_matches")), _f(matches_played)
    if matches <= 0 or (season > 0 and matches < MATCH_COVERAGE_MIN * season):
        return {}
    mapping = (("shots", "shots"), ("shots_on_target", "shots_on_target"), ("fouls", "fouls_committed"),
               ("fouled", "fouls_suffered"), ("yellow_cards", "yellow"), ("red_cards", "red"))
    return {dst: _f(totals.get(f"m_{src}")) for dst, src in mapping}


# --------------------------------------------------------------------------- goleiro adversário nas previsões
LEAGUE_SAVE_PCT = 0.70
GK_FACTOR_PRIOR_SHOTS = 40.0
GK_FACTOR_BOUNDS = (0.85, 1.15)


def gk_goal_factor(flat: Mapping[str, Any], league_save_pct: float = LEAGUE_SAVE_PCT) -> Optional[Dict[str, float]]:
    """Fator multiplicativo na chance de GOL de quem enfrenta este goleiro (1,0 = goleiro médio).

    Usa a taxa de gols sofridos por chute no alvo, suavizada para a média da liga
    (``GK_FACTOR_PRIOR_SHOTS`` chutes fictícios) e limitada a ±15%. ``None`` sem dados.
    """
    gk = gk_totals(flat)
    if gk is None:
        return None
    sota, saves = gk["sota"], gk["saves"]
    if not sota or saves is None or sota < 5:
        return None
    save_rate = (saves + GK_FACTOR_PRIOR_SHOTS * league_save_pct) / (sota + GK_FACTOR_PRIOR_SHOTS)
    base_conceded = max(1e-6, 1.0 - league_save_pct)
    ratio = (1.0 - save_rate) / base_conceded
    lo, hi = GK_FACTOR_BOUNDS
    return {"factor": round(max(lo, min(hi, ratio)), 3), "save_pct": round(100 * saves / sota, 1),
            "shots_on_target_faced": sota, "source": gk["source"]}


def league_save_pct(peers: Iterable[Mapping[str, Any]]) -> float:
    """% de defesa média dos goleiros da liga (defesas ÷ chutes no alvo); 70% com amostra pequena (< 150 chutes)."""
    saves = sota = 0.0
    for flat in peers:
        gk = gk_totals(flat)
        if gk and gk.get("sota"):
            saves += float(gk.get("saves") or 0)
            sota += float(gk["sota"])
    return saves / sota if sota >= 150 else LEAGUE_SAVE_PCT


def reduce_peer_metrics(role: str, flats: Iterable[Mapping[str, Any]], min_minutes: float) -> List[Dict[str, Optional[float]]]:
    flats = list(flats)
    league_pct = league_save_pct(flats) if role == "GK" else None
    return [
        compute_metrics(role, flat, league_pct) for flat in flats
        if (_num(flat, "minutes_played") or 0) >= min_minutes
    ]


__all__ = [
    "classify_role", "infer_role", "gk_totals", "aggregate_match_rows", "apply_match_totals", "compute_metrics", "score_index", "flatten_stat", "gk_goal_factor",
    "reduce_peer_metrics", "league_save_pct", "complementary_from_totals", "anchor_score", "percentile_score", "reliability",
    "ROLE_LABELS", "INDEX_NAMES", "COMPONENTS", "MIN_PEERS",
]
