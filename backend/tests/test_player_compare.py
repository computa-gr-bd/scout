from types import SimpleNamespace

from app.services import player_compare as pc


def _stat(**kw):
    base = dict(matches_played=30, minutes_played=2520, shots_per_90=2.0, xg_per_90=0.35, xa_per_90=0.2,
                key_passes_per_90=1.25, goals_per_90=0.35, assists_per_90=0.2)
    base.update(kw)
    return SimpleNamespace(**base)


EXTRAS = {"npxg_per_90": 0.35, "xg_chain_per_90": 0.5, "xg_buildup_per_90": 0.4}


def test_offense_rating_mirrors_the_player_screen_formula():
    values = pc.offense_values(_stat(), EXTRAS)
    rating = pc.offense_rating(values, "ATT")
    parts = {a["key"]: a["score"] for a in rating["axes"]}
    # norm(v, max) = v / max * 100, média das métricas do componente (igual a Player.tsx)
    assert parts["fin"] == round((2.0 / 4 * 100 + 0.35 / 0.7 * 100) / 2, 1) == 50.0
    assert parts["cre"] == round((0.2 / 0.4 * 100 + 1.25 / 2.5 * 100 + 0.5 / 1.0 * 100) / 3, 1) == 50.0
    assert parts["pro"] == round((0.35 / 0.7 * 100 + 0.2 / 0.4 * 100) / 2, 1) == 50.0
    assert parts["con"] == 50.0
    assert parts["reg"] == 93.0 or abs(parts["reg"] - 2520 / (30 * 90) * 100) < 0.1
    assert rating["overall"] == round(0.3 * 50 + 0.25 * 50 + 0.25 * 50 + 0.1 * 50 + 0.1 * parts["reg"])


def test_midfielders_use_their_own_weights_and_values_are_capped_at_100():
    values = pc.offense_values(_stat(shots_per_90=9.0, key_passes_per_90=9.0), EXTRAS)
    att = pc.offense_rating(values, "ATT")
    mid = pc.offense_rating(values, "MID")
    assert {a["key"]: a["weight"] for a in mid["axes"]}["cre"] == 0.30
    assert {a["key"]: a["weight"] for a in att["axes"]}["fin"] == 0.30
    assert all(0 <= a["score"] <= 100 for a in att["axes"])
    assert att["overall"] != mid["overall"]


def test_missing_npxg_falls_back_to_xg_and_league_averages_are_attached():
    values = pc.offense_values(_stat(xg_per_90=0.42), {"npxg_per_90": 0.0, "xg_chain_per_90": 0.0, "xg_buildup_per_90": 0.0})
    assert values["npxg_per_90"] == 0.42
    league = {"shots_per_90": 1.5, "xg_per_90": 0.3, "npxg_per_90": 0.0, "xa_per_90": 0.1, "key_passes_per_90": 0.9,
              "xg_chain_per_90": 0.33, "goals_per_90": 0.2, "assists_per_90": 0.1, "xg_buildup_per_90": 0.28}
    rating = pc.offense_rating(values, "ATT", league)
    metrics = {m["key"]: m for a in rating["axes"] for m in a["metrics"]}
    assert metrics["shots_per_90"]["league_avg"] == 1.5
    assert metrics["npxg_per_90"]["league_avg"] == 0.3        # sem npxG da liga usa o xG
    assert metrics["minutes_share"]["league_avg"] is None


def test_family_of_role():
    assert pc.family_of("ATT") == pc.family_of("MID") == "OFF"
    assert pc.family_of("DEF") == "DEF" and pc.family_of("GK") == "GK" and pc.family_of(None) is None


def _player(pid, name, scores):
    axes = [{"key": f"a{i}", "label": f"Eixo {i}", "score": s, "metrics": []} for i, s in enumerate(scores)]
    overall = int(round(sum(s for s in scores if s is not None) / len(scores)))
    return {"available": True, "player_id": pid, "name": name, "axes": axes, "overall": overall, "index_name": "Índice"}


def test_compare_summary_names_leaders_and_ties():
    a = _player(1, "Forte", [80, 70, 60, 50, 90])
    b = _player(2, "Fraco", [40, 71, 30, 20, 88])
    summary = pc.compare_summary([a, b])
    leaders = {l["axis"]: l["player_id"] for l in summary["leaders"]}
    assert leaders["a0"] == 1 and leaders["a1"] is None and leaders["a4"] is None   # < 3 pontos = empate
    assert any("Forte lidera" in line for line in summary["lines"])
    assert any("Empate técnico" in line for line in summary["lines"])
    solo = pc.compare_summary([a])
    assert solo["leaders"] == [] and solo["lines"] == []


def test_highlights_pick_best_and_worst_components():
    axes = [{"label": "A", "score": 90}, {"label": "B", "score": 20}, {"label": "C", "score": 50}, {"label": "D", "score": None}]
    strengths, weaknesses = pc.highlights(axes)
    assert strengths == ["A (90)"] and weaknesses == ["B (20)"]


def test_offense_vector_matches_component_scores_and_similarity_is_symmetric():
    from app.services import stats_math as sm
    v1 = pc.offense_vector(pc.offense_values(_stat(), EXTRAS))
    v2 = pc.offense_vector(pc.offense_values(_stat(shots_per_90=3.0), EXTRAS))
    assert len(v1) == 5 and sm.profile_similarity(v1, v1) == 100.0
    assert sm.profile_similarity(v1, v2) == sm.profile_similarity(v2, v1) < 100.0


def test_season_label():
    assert pc.season_label("2025") == "2025/26" and pc.season_label("2024/2025") == "2024/2025"
