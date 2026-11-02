"""Índices de defensor/goleiro e leitura de estatísticas extras do FBref (módulos puros)."""
import pandas as pd

from app.services.fbref_stats import (
    extract_keeper_match, extract_season_stats, finalize_totals, merge_totals,
)
from app.services.position_index import (
    MIN_PEERS, anchor_score, classify_role, compute_metrics, flatten_stat, gk_goal_factor,
    infer_role, percentile_score, reliability, score_index,
)


def test_classify_role_handles_all_sources():
    assert classify_role("GK") == "GK"
    assert classify_role("Goalkeeper") == "GK"
    assert classify_role("D M S") == "DEF"          # Understat: principal = primeira; S = reserva
    assert classify_role("F M S") == "ATT"
    assert classify_role("S") is None
    assert classify_role("DF,MF") == "DEF"           # FBref
    assert classify_role("Centre-Back") == "DEF"
    assert classify_role("Defence") == "DEF"
    assert classify_role("Midfield") == "MID"
    assert classify_role("Left Winger") == "ATT"
    assert classify_role(None) is None


def test_fbref_keeper_columns_use_group_to_disambiguate():
    row = {
        ("Performance", "GA"): 30, ("Performance", "SoTA"): 100, ("Performance", "Saves"): 70,
        ("Performance", "Save%"): 70.0, ("Performance", "CS"): 8, ("Performance", "CS%"): 25.0,
        ("Penalty Kicks", "PKatt"): 4, ("Penalty Kicks", "PKA"): 3, ("Penalty Kicks", "PKsv"): 1,
        ("Penalty Kicks", "Save%"): 25.0,
    }
    out = extract_season_stats("keeper", row)
    assert out["gk_saves"] == 70 and out["gk_sota"] == 100 and out["gk_clean_sheets"] == 8
    assert out["gk_pk_saved"] == 1
    adv = extract_season_stats("keeper_adv", {
        ("Launched", "Att"): 400, ("Launched", "Cmp"): 200, ("Goal Kicks", "Att"): 120,
        ("Passes", "Att (GK)"): 900, ("Expected", "PSxG"): 35.2,
        ("Sweeper", "#OPA"): 20, ("Sweeper", "AvgDist"): 15.5,
    })
    assert adv["gk_launched_att"] == 400 and adv["gk_goalkick_att"] == 120
    assert adv["gk_psxg"] == 35.2 and adv["gk_opa_dist_sum"] == 310.0


def test_fbref_ignores_missing_and_ambiguous_cells():
    out = extract_season_stats("defense", {
        ("Tackles", "Tkl"): 40, ("Challenges", "Tkl"): 10, ("Challenges", "Lost"): float("nan"),
        "Int": 22,
    })
    assert out["tkl"] == 40 and out["dribblers_tkl"] == 10 and out["interceptions"] == 22
    assert "dribbled_past" not in out
    # rótulo ambíguo sem grupo pedido não é adivinhado
    assert extract_season_stats("passing", {("Short", "Att"): 5, ("Long", "Att"): 7}) == {
        "pass_short_att": 5.0, "pass_long_att": 7.0,
    }


def test_totals_are_summed_across_clubs_and_finalized():
    totals: dict = {}
    merge_totals(totals, {"gk_saves": 30, "gk_psxg": 10.123})
    merge_totals(totals, {"gk_saves": 20, "gk_psxg": 5.0})
    done = finalize_totals(totals)
    assert done == {"gk_saves": 50, "gk_psxg": 15.12}


def test_keeper_match_row():
    out = extract_keeper_match({("Performance", "Saves"): 3, ("Performance", "GA"): 1})
    assert out == {"saves": 3, "goals_conceded": 1, "shots_faced": 4}


def test_scores_anchor_and_percentile():
    assert anchor_score(5, 0, 10) == 50
    assert anchor_score(5, 0, 10, invert=True) == 50
    assert anchor_score(20, 0, 10) == 100
    assert percentile_score(3, [1, 2, 3, 4, 5]) == 50.0
    assert percentile_score(5, [1, 2, 3, 4, 5], invert=True) == 10.0


def _gk(saves, sota, ga, psxg, minutes=1800, matches=20, cs=7):
    return flatten_stat(
        {"minutes_played": minutes, "matches_played": matches},
        {"soccerdata": {"gk_saves": saves, "gk_sota": sota, "gk_ga": ga, "gk_psxg": psxg,
                        "gk_clean_sheets": cs, "gk_crosses_opp": 100, "gk_crosses_stopped": 9,
                        "gk_opa": 25, "gk_launched_cmp": 180, "gk_launched_att": 400,
                        "pass_cmp": 600, "pass_att": 800, "gk_pk_att": 3, "gk_pk_saved": 1}},
    )


def test_goalkeeper_index_ranks_better_keeper_higher():
    good = score_index("GK", compute_metrics("GK", _gk(80, 100, 20, 28)), minutes=1800)
    bad = score_index("GK", compute_metrics("GK", _gk(60, 100, 40, 30)), minutes=1800)
    assert good["available"] and bad["available"]
    assert good["index"] > bad["index"]
    assert {c["key"] for c in good["components"]} >= {"shot_stopping", "distribution"}
    assert good["method"] == "anchor"                    # sem pares -> âncoras


def test_goalkeeper_percentile_when_enough_peers():
    peers = [compute_metrics("GK", _gk(60 + i, 100, 40 - i, 32)) for i in range(MIN_PEERS + 2)]
    best = compute_metrics("GK", _gk(75, 100, 25, 32))
    res = score_index("GK", best, peers, minutes=1800)
    assert res["method"] == "percentile" and res["peers"] == MIN_PEERS + 2
    middle = score_index("GK", compute_metrics("GK", _gk(65, 100, 35, 32)), peers, minutes=1800)
    # melhor que todos os pares nas métricas que variam (as demais empatam em 50)
    assert res["index"] > middle["index"] > 45
    shot = next(c for c in res["components"] if c["key"] == "shot_stopping")
    assert shot["score"] == 100.0


def test_save_pct_is_shrunk_for_tiny_samples():
    tiny = compute_metrics("GK", _gk(3, 3, 0, 1.0, minutes=270, matches=3, cs=3))
    assert tiny["save_pct"] < 85          # 3/3 não vira 100%


def test_defender_index_and_missing_data():
    flat = flatten_stat(
        {"minutes_played": 1800, "matches_played": 20, "aerials_won": 60, "aerials_lost": 30},
        {"soccerdata": {"tkl": 50, "tkl_won": 35, "tkl_plus_int": 90, "interceptions": 40,
                        "clearances": 120, "blocks": 30, "blocks_shots": 12, "progressive_passes": 110,
                        "progressive_carries": 25, "pass_cmp": 900, "pass_att": 1000,
                        "fouls": 18, "yellow_cards": 3, "red_cards": 0, "errors": 1, "dribbled_past": 15}},
    )
    res = score_index("DEF", compute_metrics("DEF", flat), minutes=1800)
    assert res["available"] and 0 <= res["index"] <= 100
    assert 0.7 < res["coverage"] < 1.0          # sem dados "em campo" (derivados), o resto está completo

    # só colunas básicas da tabela (sem FBref avançado): cobertura parcial, mas ainda calcula
    thin = flatten_stat({"minutes_played": 1800, "matches_played": 20, "tackles": 30, "interceptions": 25,
                         "clearances": 80, "aerials_won": 40, "aerials_lost": 30}, None)
    res_thin = score_index("DEF", compute_metrics("DEF", thin), minutes=1800)
    assert res_thin["available"] and res_thin["coverage"] < 1.0

    empty = score_index("DEF", compute_metrics("DEF", flatten_stat({"minutes_played": 900, "matches_played": 10}, None)), minutes=900)
    assert not empty["available"] and empty["index"] is None


def test_low_minutes_pull_index_toward_fifty():
    metrics = compute_metrics("GK", _gk(85, 100, 15, 30))
    full = score_index("GK", metrics, minutes=1800)
    short = score_index("GK", metrics, minutes=400)
    assert full["index"] > short["index"] > 49
    assert reliability(400) == 0.4 or reliability(400) < 0.5


def test_gk_goal_factor_bounds_and_direction():
    great = gk_goal_factor({"gk_saves": 140, "gk_sota": 180})
    poor = gk_goal_factor({"gk_saves": 100, "gk_sota": 180})
    assert great["factor"] < 1.0 < poor["factor"]
    assert 0.85 <= great["factor"] and poor["factor"] <= 1.15
    assert gk_goal_factor({"gk_saves": 1, "gk_sota": 2}) is None
    assert gk_goal_factor({}) is None


def test_infer_role_uses_understat_position_and_goalkeeper_evidence():
    assert infer_role(None, "D S") == "DEF"                      # Player.position vazio, Understat tem
    assert infer_role("", None, flat={"d_gk_matches": 12}) == "GK"
    assert infer_role(None, None, flat={"gk_sota": 40}) == "GK"
    assert infer_role(None, None, flat={}) is None
    assert infer_role("GK", "F") == "GK"                         # primeira posição reconhecível vence


def test_zero_columns_from_sources_without_the_stat_are_unknown_not_bad():
    flat = flatten_stat({"minutes_played": 1800, "matches_played": 20, "clearances": 0, "aerials_won": 0,
                         "aerials_lost": 0, "tackles": 0, "interceptions": 0, "fouls_committed": 0}, None)
    assert not {"clearances", "aerials_won", "tackles", "fouls_committed"} & set(flat)
    metrics = compute_metrics("DEF", flat)
    assert metrics["clearances_p90"] is None and metrics["aerials_won_p90"] is None
    assert metrics["tkl_int_p90"] is None


def test_defender_index_works_with_understat_and_derived_only():
    flat = flatten_stat(
        {"minutes_played": 1800, "matches_played": 20, "key_passes": 14},
        {"derived": {"onp_90s": 20.0, "onp_xga": 20.0, "onp_ga": 18.0, "onp_shots_against": 220.0}},
        {"xg_buildup": 9.0, "xg_chain": 14.0, "yellow_cards": 3, "red_cards": 0, "position": "D S"},
    )
    metrics = compute_metrics("DEF", flat)
    assert abs(metrics["onpitch_xga_p90"] - 1.0) < 1e-9 and abs(metrics["onpitch_shots_p90"] - 11.0) < 1e-9
    assert abs(metrics["xg_buildup_p90"] - 0.45) < 1e-9 and abs(metrics["cards_p90"] - 0.15) < 1e-9
    res = score_index("DEF", metrics, minutes=1800)
    assert res["available"]
    keys = {c["key"] for c in res["components"] if c["score"] is not None}
    assert {"onpitch", "buildup", "discipline", "availability"} <= keys
    assert "duels" not in keys and "aerial" not in keys       # sem FBref: componentes ficam fora, não zerados


def test_goalkeeper_index_from_derived_shots_without_fbref():
    flat = flatten_stat(
        {"minutes_played": 1800, "matches_played": 20},
        {"derived": {"gk_matches": 20, "gk_minutes": 1800, "gk_sota": 80, "gk_saves": 56,
                     "gk_ga": 24, "gk_xgot": 27.0, "gk_clean_sheets": 7}},
    )
    metrics = compute_metrics("GK", flat)
    assert abs(metrics["psxg_diff_p90"] - 0.15) < 1e-9
    assert abs(metrics["ga_p90"] - 1.2) < 1e-9 and metrics["clean_sheet_pct"] == 35.0
    res = score_index("GK", metrics, minutes=1800)
    assert res["available"] and res["index"] > 50
    assert gk_goal_factor(flat)["source"] == "derived"


def test_fbref_totals_win_over_derived_for_goalkeepers():
    flat = flatten_stat(
        {"minutes_played": 1800, "matches_played": 20},
        {"derived": {"gk_matches": 20, "gk_minutes": 1800, "gk_sota": 80, "gk_saves": 56, "gk_ga": 24, "gk_xgot": 27.0},
         "soccerdata": {"gk_saves": 70, "gk_sota": 100, "gk_ga": 30, "gk_psxg": 33.0}},
    )
    from app.services.position_index import gk_totals
    assert gk_totals(flat)["source"] == "fbref" and gk_totals(flat)["sota"] == 100
