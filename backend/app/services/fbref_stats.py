"""Estatísticas extras do FBref (goleiro, defesa, passes, posse) lidas via SoccerData.

Módulo **puro** (só ``re``/``math``/``pandas``): não toca no banco. O ``soccerdata_sync`` usa
``extract_season_stats`` para transformar as linhas já "achatadas" por ``_records`` em contagens
por jogador, que são somadas por (jogador, temporada) e guardadas em
``PlayerStatistics.supplemental_stats["soccerdata"]``.

Só guardamos CONTAGENS (e xG-like acumulados). Percentuais e valores por 90 são calculados na
leitura (``position_index``) a partir dos totais — somar percentuais de dois clubes (transferência
no meio da temporada) daria um resultado errado.

As colunas do FBref têm cabeçalho em dois níveis, ex.: ``("Performance", "Saves")``. Vários
rótulos se repetem em grupos diferentes (``Att`` aparece em Launched, Passes, Goal Kicks...),
por isso cada coluna é pedida pelo par (rótulo, trecho do grupo).
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import pandas as pd

# Nome do tipo de estatística na SoccerData (sazonal) -> campos extraídos.
# Cada campo: (chave_salva, rótulo_da_coluna, trecho_do_grupo | None, kind)
#   kind: "int" soma como inteiro; "float" soma como float (xG, PSxG, distâncias).
ColumnSpec = Tuple[str, str, Optional[str], str]

SEASON_STAT_SPECS: Dict[str, List[ColumnSpec]] = {
    # --- goleiros -----------------------------------------------------------------
    "keeper": [
        ("gk_ga", "GA", "performance", "int"),
        ("gk_sota", "SoTA", "performance", "int"),
        ("gk_saves", "Saves", "performance", "int"),
        ("gk_clean_sheets", "CS", "performance", "int"),
        ("gk_pk_att", "PKatt", "penalty", "int"),
        ("gk_pk_allowed", "PKA", "penalty", "int"),
        ("gk_pk_saved", "PKsv", "penalty", "int"),
        ("gk_pk_missed", "PKm", "penalty", "int"),
    ],
    "keeper_adv": [
        ("gk_psxg", "PSxG", "expected", "float"),
        ("gk_launched_cmp", "Cmp", "launched", "int"),
        ("gk_launched_att", "Att", "launched", "int"),
        ("gk_passes_att", "Att (GK)", "passes", "int"),
        ("gk_throws", "Thr", "passes", "int"),
        ("gk_goalkick_att", "Att", "goal kicks", "int"),
        ("gk_crosses_opp", "Opp", "crosses", "int"),
        ("gk_crosses_stopped", "Stp", "crosses", "int"),
        ("gk_opa", "#OPA", "sweeper", "int"),
        ("gk_opa_dist_sum", "AvgDist", "sweeper", "avg_x_count"),
    ],
    # --- defesa -------------------------------------------------------------------
    "defense": [
        ("tkl", "Tkl", "tackles", "int"),
        ("tkl_won", "TklW", "tackles", "int"),
        ("tkl_def3rd", "Def 3rd", "tackles", "int"),
        ("tkl_mid3rd", "Mid 3rd", "tackles", "int"),
        ("tkl_att3rd", "Att 3rd", "tackles", "int"),
        ("dribblers_tkl", "Tkl", "challenges", "int"),
        ("dribblers_att", "Att", "challenges", "int"),
        ("dribbled_past", "Lost", "challenges", "int"),
        ("blocks", "Blocks", "blocks", "int"),
        ("blocks_shots", "Sh", "blocks", "int"),
        ("blocks_passes", "Pass", "blocks", "int"),
        ("interceptions", "Int", None, "int"),
        ("tkl_plus_int", "Tkl+Int", None, "int"),
        ("clearances", "Clr", None, "int"),
        ("errors", "Err", None, "int"),
    ],
    # --- passes -------------------------------------------------------------------
    "passing": [
        ("pass_cmp", "Cmp", "total", "int"),
        ("pass_att", "Att", "total", "int"),
        ("pass_prg_dist", "PrgDist", "total", "int"),
        ("pass_short_cmp", "Cmp", "short", "int"),
        ("pass_short_att", "Att", "short", "int"),
        ("pass_med_cmp", "Cmp", "medium", "int"),
        ("pass_med_att", "Att", "medium", "int"),
        ("pass_long_cmp", "Cmp", "long", "int"),
        ("pass_long_att", "Att", "long", "int"),
        ("key_passes", "KP", None, "int"),
        ("passes_final_third", "1/3", None, "int"),
        ("passes_into_box", "PPA", None, "int"),
        ("crosses_into_box", "CrsPA", None, "int"),
        ("progressive_passes", "PrgP", None, "int"),
        ("xag", "xAG", "expected", "float"),
    ],
    # --- posse / condução ---------------------------------------------------------
    "possession": [
        ("touches", "Touches", None, "int"),
        ("touches_def_pen", "Def Pen", "touches", "int"),
        ("touches_att_pen", "Att Pen", "touches", "int"),
        ("carries", "Carries", "carries", "int"),
        ("progressive_carries", "PrgC", "carries", "int"),
        ("carries_final_third", "1/3", "carries", "int"),
        ("carries_into_box", "CPA", "carries", "int"),
        ("miscontrols", "Mis", "carries", "int"),
        ("dispossessed", "Dis", "carries", "int"),
        ("takeons_att", "Att", "take-ons", "int"),
        ("takeons_succ", "Succ", "take-ons", "int"),
        ("progressive_passes_received", "PrgR", "receiving", "int"),
    ],
    # --- diversos (cartões, faltas, bola aérea, recuperações) -----------------------
    "misc": [
        ("yellow_cards", "CrdY", "performance", "int"),
        ("red_cards", "CrdR", "performance", "int"),
        ("fouls", "Fls", "performance", "int"),
        ("fouled", "Fld", "performance", "int"),
        ("offsides", "Off", "performance", "int"),
        ("crosses", "Crs", "performance", "int"),
        ("recoveries", "Recov", "performance", "int"),
        ("pens_won", "PKwon", "performance", "int"),
        ("pens_conceded", "PKcon", "performance", "int"),
        ("own_goals", "OG", "performance", "int"),
        ("aerials_won", "Won", "aerial", "int"),
        ("aerials_lost", "Lost", "aerial", "int"),
    ],
    "shooting": [
        ("shots", "Sh", "standard", "int"),
        ("shots_on_target", "SoT", "standard", "int"),
    ],
}

# Chaves que também existem como COLUNAS de ``PlayerStatistics`` — são copiadas para a coluna
# quando ela está vazia/zerada (``_merge_sourced_stats`` faz essa checagem).
COLUMN_BACKED_FIELDS: Dict[str, str] = {
    "interceptions": "interceptions",
    "clearances": "clearances",
    "aerials_won": "aerials_won",
    "aerials_lost": "aerials_lost",
    "key_passes": "key_passes",
    "crosses": "crosses",
    "pass_cmp": "passes_completed",
    "pass_att": "passes",
    "touches_att_pen": "touches_in_box",
    "takeons_att": "dribbles",
    "takeons_succ": "dribbles_success",
    "tkl_won": "tackles",
}

# Campos de goleiro que o FBref só publica para quem jogou de goleiro.
GK_FIELDS = tuple(spec[0] for specs in (SEASON_STAT_SPECS["keeper"], SEASON_STAT_SPECS["keeper_adv"]) for spec in specs)


# --------------------------------------------------------------------------- leitura de células
def missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):  # listas/arrays não são células numéricas
        return False


def to_float(value: Any) -> Optional[float]:
    if missing(value):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", "").replace("%", "")
        if not value:
            return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clean(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text).strip().lower())


def _parts(key: Any) -> Tuple[str, ...]:
    raw = key if isinstance(key, tuple) else (key,)
    return tuple(_clean(p) for p in raw if p not in (None, ""))


def cell(row: Mapping[Any, Any], label: str, group_hint: Optional[str]) -> Optional[float]:
    """Valor numérico da coluna ``label`` (último nível do cabeçalho) dentro do grupo ``group_hint``.

    Sem ``group_hint`` só aceita a coluna se o rótulo for único na linha (evita pegar ``Att`` errado).
    """
    wanted = _clean(label)
    hint = _clean(group_hint) if group_hint else None
    matches: List[Tuple[Tuple[str, ...], Any]] = []
    for key, value in row.items():
        parts = _parts(key)
        if parts and parts[-1] == wanted:
            matches.append((parts, value))
    if not matches:
        return None
    if hint:
        in_group = [value for parts, value in matches if any(hint in part for part in parts[:-1])]
        if not in_group:
            return None
        for value in in_group:
            number = to_float(value)
            if number is not None:
                return number
        return None
    if len(matches) > 1:
        # mesmo rótulo em vários grupos e nenhum foi pedido: ambíguo -> melhor não adivinhar.
        non_empty = [value for _, value in matches if to_float(value) is not None]
        if len(non_empty) != 1:
            return None
        return to_float(non_empty[0])
    return to_float(matches[0][1])


def extract_season_stats(stat_type: str, row: Mapping[Any, Any]) -> Dict[str, float]:
    """Contagens de UMA linha (jogador-time) do tipo ``stat_type``; campos ausentes são omitidos."""
    out: Dict[str, float] = {}
    for key, label, group, kind in SEASON_STAT_SPECS.get(stat_type, []):
        value = cell(row, label, group)
        if value is None:
            continue
        if kind == "avg_x_count":
            # AvgDist (jardas/metros médios) só tem sentido ponderado pelas ações (#OPA).
            opa = cell(row, "#OPA", "sweeper")
            if opa:
                out[key] = value * opa
            continue
        out[key] = float(int(round(value))) if kind == "int" else float(value)
    return out


def merge_totals(target: Dict[str, float], addition: Mapping[str, float]) -> None:
    """Soma ``addition`` em ``target`` (jogador que passou por dois clubes na temporada)."""
    for key, value in addition.items():
        target[key] = target.get(key, 0.0) + float(value)


def finalize_totals(totals: Mapping[str, float]) -> Dict[str, Any]:
    """Inteiros viram ``int``; xG-likes ficam com 2 casas. Remove zeros de goleiro em não-goleiros."""
    float_keys = {key for specs in SEASON_STAT_SPECS.values() for key, _, _, kind in specs if kind != "int"}
    out: Dict[str, Any] = {}
    for key, value in totals.items():
        out[key] = round(value, 2) if key in float_keys else int(round(value))
    return out


# --------------------------------------------------------------------------- partidas (goleiro)
def extract_keeper_match(row: Mapping[Any, Any]) -> Dict[str, Any]:
    """Defesas / gols sofridos / chutes no alvo sofridos de uma linha de ``keepers`` por partida."""
    saves = cell(row, "Saves", "performance")
    ga = cell(row, "GA", "performance")
    sota = cell(row, "SoTA", "performance")
    psxg = cell(row, "PSxG", "expected")
    out: Dict[str, Any] = {}
    if saves is not None:
        out["saves"] = int(round(saves))
    if ga is not None:
        out["goals_conceded"] = int(round(ga))
    if sota is not None:
        out["shots_faced"] = int(round(sota))
    elif saves is not None and ga is not None:
        out["shots_faced"] = int(round(saves + ga))
    if psxg is not None:
        out["psxg"] = round(float(psxg), 3)
    return out


def summarize_table(rows: List[Mapping[Any, Any]]) -> Dict[str, Any]:
    """Resumo de uma tabela do FBref para diagnóstico: quais colunas numéricas têm dado de verdade.

    Serve para descobrir tabelas que o FBref deixou vazias (ex.: avançadas, após a saída da Opta).
    """
    if not rows:
        return {"rows": 0, "numeric_columns_with_data": 0, "numeric_columns_empty": 0, "sample_with_data": [], "sample_empty": []}
    filled: Dict[str, int] = {}
    seen: Dict[str, int] = {}
    for row in rows:
        for key, value in row.items():
            parts = _parts(key)
            if not parts or parts[-1] in {"player", "team", "league", "season", "nation", "pos", "age", "born", "game_id", "date"}:
                continue
            name = " / ".join(parts)
            seen[name] = seen.get(name, 0) + 1
            if to_float(value) is not None:
                filled[name] = filled.get(name, 0) + 1
    with_data = sorted(k for k in seen if filled.get(k))
    empty = sorted(k for k in seen if not filled.get(k))
    return {
        "rows": len(rows), "numeric_columns_with_data": len(with_data), "numeric_columns_empty": len(empty),
        "sample_with_data": with_data[:14], "sample_empty": empty[:14],
    }


def sum_field(rows: Iterable[Mapping[str, Any]], key: str) -> float:
    return sum(float(r.get(key) or 0) for r in rows)


__all__ = [
    "SEASON_STAT_SPECS", "COLUMN_BACKED_FIELDS", "GK_FIELDS", "to_float", "cell",
    "extract_season_stats", "merge_totals", "finalize_totals", "extract_keeper_match", "summarize_table",
]
