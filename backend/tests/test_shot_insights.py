from types import SimpleNamespace

from app.services.shot_insights import _defense_profile, _predictions_for_team


def test_player_estimates_include_top_ten_per_team():
    players = {
        player_id: {
            "player_id": player_id,
            "name": f"Player {player_id}",
            "shots": 20 - player_id,
            "on_target": 10 - player_id // 2,
            "goals": 5 - player_id // 3,
            "xg": 2.0 - player_id / 10,
            "assists": player_id // 2,
            "zones": {"central_box": {"n": 5, "xg": 0.8}},
        }
        for player_id in range(1, 12)
    }

    predictions, matchups = _predictions_for_team(
        side="home",
        team_id=1,
        players=players,
        n_matches=10,
        opp_weak={
            "central_box": {"n": 1.0, "xg": 0.5, "weakness_score": 0.5,
                            "ratio_vs_league": 1.0, "zone": "central_box"},
        },
        opp_name="Opponent",
    )

    predicted_players = {prediction["player_id"] for prediction in predictions}
    assert len(predicted_players) == 10
    assert 11 not in predicted_players
    assert len(matchups) == 10
    assert {prediction["target"] for prediction in predictions} == {
        "shot", "shot_on_target", "goal", "goal_involvement",
    }


def _shot(team_id, match_id, x, y, xg, goal=False):
    return SimpleNamespace(
        team_id=team_id, match_id=match_id, outcome="goal" if goal else "saved",
        position=SimpleNamespace(x=x, y=y),
        shot=SimpleNamespace(xg=xg, is_goal=goal, on_target=True),
    )


def test_defense_profile_reports_totals_reliability_and_trend():
    # time 1 sofre chutes do time 2; o mais recente é o jogo 10 (match_ids vem do mais novo ao mais antigo)
    match_ids = list(range(10, 0, -1))
    events = [_shot(2, 10, 95, 50, 0.5, goal=True), _shot(2, 9, 94, 52, 0.3), _shot(2, 8, 93, 48, 0.2)]
    events += [_shot(2, mid, 95, 50, 0.1) for mid in (7, 6, 5)]
    own_box = next(z for z in _defense_profile(events, {1}, match_ids, {"own_box": 0.1}) if z["zone"] == "own_box")

    assert own_box["shots_conceded"] == 6 and own_box["goals_conceded"] == 1
    assert abs(own_box["xga"] - 1.3) < 1e-6
    assert own_box["goals_minus_xga"] == round(1 - 1.3, 3)
    assert own_box["reliability"] == "medium"          # 6 chutes, 10 jogos
    assert own_box["trend"] == "worse"                 # o xG concedido está concentrado nos últimos jogos
    assert own_box["ratio_recent"] > own_box["ratio_vs_league"] > 1.0
    assert own_box["share_of_xga_pct"] == 100.0


def test_defense_profile_zone_without_data_is_not_a_weakness():
    zones = _defense_profile([], {1}, [3, 2, 1], {})
    assert all(z["weakness_score"] == 0.0 and z["reliability"] == "low" for z in zones)


def _two_players():
    return {
        pid: {
            "player_id": pid, "name": f"P{pid}", "shots": 16, "on_target": 8, "goals": 4, "xg": 3.0,
            "assists": 1, "zones": {"central_box": {"n": 8, "xg": 2.0}},
        }
        for pid in (1, 2)
    }


def _by_target(preds, pid):
    return {p["target"]: p for p in preds if p["player_id"] == pid}


def test_expected_minutes_lower_the_estimate_for_rotated_players():
    minutes = {1: [90] * 8, 2: [0, 0, 0, 90, 0, 0, 90, 0]}   # 2 quase não joga mais
    preds, _ = _predictions_for_team("home", 1, _two_players(), 8, {}, "Rival", minutes=minutes)
    starter, rotated = _by_target(preds, 1), _by_target(preds, 2)
    assert starter["shot"]["probability"] > rotated["shot"]["probability"]
    assert starter["shot"]["expected_minutes"] > 70 > rotated["shot"]["expected_minutes"]
    assert starter["shot"]["minutes_known"] is True
    assert any(f["feature"] == "minutes" for f in rotated["shot"]["negative_factors"])


def test_unknown_minutes_keep_the_previous_team_based_rate():
    preds, _ = _predictions_for_team("home", 1, _two_players(), 8, {}, "Rival")
    p = _by_target(preds, 1)["shot"]
    assert p["minutes_known"] is False and p["expected_minutes"] is None
    assert abs(p["shots_per_match"] - 2.0) < 1e-6      # 16 chutes / 8 jogos


def test_opposing_goalkeeper_only_changes_goal_targets():
    gk = {"name": "Ederson", "goal_factor": 0.88}
    base, _ = _predictions_for_team("home", 1, _two_players(), 8, {}, "Rival")
    with_gk, _ = _predictions_for_team("home", 1, _two_players(), 8, {}, "Rival", opp_gk=gk)
    b, g = _by_target(base, 1), _by_target(with_gk, 1)
    assert g["shot"]["probability"] == b["shot"]["probability"]
    assert g["shot_on_target"]["probability"] == b["shot_on_target"]["probability"]
    assert g["goal"]["probability"] < b["goal"]["probability"]
    assert g["goal_involvement"]["probability"] < b["goal_involvement"]["probability"]
    assert g["goal"]["gk_factor"] == 0.88
    assert any(f["feature"] == "opp_gk" for f in g["goal"]["negative_factors"])


def _bursty_and_steady():
    """Dois jogadores com o MESMO total de chutes: um regular, outro que alterna 0 e 6."""
    match_ids = list(range(8, 0, -1))
    steady = {m: {"shots": 3, "on_target": 1, "xg": 0.3} for m in match_ids}
    bursty = {m: {"shots": (6 if m % 2 else 0), "on_target": (2 if m % 2 else 0), "xg": (0.6 if m % 2 else 0.0)}
              for m in match_ids}
    players = {}
    for pid, by in ((1, steady), (2, bursty)):
        players[pid] = {
            "player_id": pid, "name": f"P{pid}", "shots": 24, "on_target": 8, "goals": 2, "xg": 2.4,
            "assists": 1, "zones": {"central_box": {"n": 12, "xg": 1.2}}, "by_match": by,
        }
    return match_ids, players


def test_predictions_carry_distribution_scenarios_and_conversion():
    match_ids, players = _bursty_and_steady()
    preds, _ = _predictions_for_team("home", 1, players, 8, {}, "Rival", match_ids=match_ids)
    shot = _by_target(preds, 1)["shot"]
    goal = _by_target(preds, 1)["goal"]

    dist = shot["distribution"]
    assert dist["model"] == "negative_binomial" and dist["dispersion"] > 0
    assert len(dist["probs"]) == 4 and abs(sum(dist["probs"]) - 1.0) < 2e-3
    assert abs((1 - dist["probs"][0]) - shot["probability"]) < 2e-3        # P(>=1) = 1 - P(0)
    assert dist["p_at_least_2"] < shot["probability"]
    assert goal["distribution"]["model"] == "poisson"

    sc = shot["scenarios"]
    assert sc["conservative"] < sc["base"] < sc["favorable"]
    assert abs(sc["base"] - shot["probability"]) < 1e-3
    assert sc["level"] in ("stable", "moderate", "sensitive")

    assert shot["conversion"] is None
    conv = goal["conversion"]
    assert 0 < conv["p_on_target"] < 1 and 0 < conv["p_goal_given_sot"] < 1


def test_negative_binomial_lowers_chance_of_at_least_one_vs_poisson():
    match_ids, players = _bursty_and_steady()
    preds, _ = _predictions_for_team("home", 1, players, 8, {}, "Rival", match_ids=match_ids)
    shot = _by_target(preds, 1)["shot"]
    from app.services.stats_math import poisson_at_least
    assert shot["baseline_probability"] < poisson_at_least(1, shot["rate_per_match"])


def test_form_trend_reports_recent_xg_against_the_window():
    match_ids = list(range(10, 0, -1))
    hot = {m: {"shots": 2, "on_target": 1, "xg": (0.8 if m > 5 else 0.1)} for m in match_ids}   # últimos 5 jogos quentes
    players = {1: {
        "player_id": 1, "name": "P1", "shots": 20, "on_target": 10, "goals": 3, "xg": 4.5, "assists": 0,
        "zones": {"central_box": {"n": 10, "xg": 2.0}}, "by_match": hot,
    }}
    preds, _ = _predictions_for_team("home", 1, players, 10, {}, "Rival", match_ids=match_ids)
    shot = _by_target(preds, 1)["shot"]
    assert shot["form"]["trend"] == "up" and shot["form"]["delta_pct"] > 15
    assert any(f["feature"] == "form" for f in shot["positive_factors"])
    # sem partidas por jogador (dados antigos): sem tendência, sem quebrar
    legacy, _ = _predictions_for_team("home", 1, _two_players(), 8, {}, "Rival")
    assert _by_target(legacy, 1)["shot"]["form"] is None
