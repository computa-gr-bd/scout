from types import SimpleNamespace

from app.services import stats_math as sm
from app.services.match_report import aggregate_team, build_report, lane_of_y, zone_lane


def _shot(team_id, match_id, x, y, xg, goal=False, on_target=True, outcome=None, situation="OpenPlay"):
    return SimpleNamespace(
        team_id=team_id, match_id=match_id, outcome=outcome or ("goal" if goal else "saved"),
        position=SimpleNamespace(x=x, y=y),
        shot=SimpleNamespace(xg=xg, is_goal=goal, on_target=on_target, situation=situation),
    )


def test_poisson_matrix_is_a_distribution_and_favours_the_stronger_side():
    matrix = sm.score_matrix(1.8, 0.9)
    assert abs(sum(sum(row) for row in matrix) - 1.0) < 1e-9
    probs = sm.outcome_probs(matrix)
    assert abs(probs["home"] + probs["draw"] + probs["away"] - 1.0) < 1e-9
    assert probs["home"] > probs["away"]
    assert 0 < probs["btts"] < 1 and 0 < probs["over_2_5"] < 1


def test_shrinkage_pulls_small_samples_to_the_league_average():
    assert sm.shrunk_ratio(0, 0, 1.3) == 1.0
    small = sm.shrunk_ratio(6.0, 2, 1.3)    # 3 xG por jogo em 2 jogos
    large = sm.shrunk_ratio(30.0, 10, 1.3)  # mesmo ritmo em 10 jogos
    assert 1.0 < small < large
    rate, att, dfn = sm.blend_rate(14, 10, 12, 10, 1.3, 1.05)
    assert rate > 1.3 * 1.05 * 0.9 and att > 1.0 and dfn < 1.0


def test_negative_binomial_range_is_wider_than_poisson():
    plo, phi = sm.quantile_range(13.0, 0.0)
    nlo, nhi = sm.quantile_range(13.0, 0.15)
    assert nhi - nlo >= phi - plo
    assert sm.quantile_range(0.0) == (0, 0)


def test_profile_similarity():
    assert sm.profile_similarity([80, 60, 40], [80, 60, 40]) == 100.0
    assert sm.profile_similarity([80, None, 40], [70, 65, None]) is None  # só 1 eixo em comum
    assert sm.profile_similarity([90, 90, 90], [10, 10, 10]) < 30


def test_lane_helpers_follow_the_zone_geometry():
    assert lane_of_y(10) == "left" and lane_of_y(50) == "center" and lane_of_y(80) == "right"
    assert zone_lane("outside_box_left") == "left" and zone_lane("opp_right_channel") == "right"
    assert zone_lane("central_box") == "center"


def test_aggregate_team_splits_for_and_against_and_ignores_own_goals():
    events = [
        _shot(1, 10, 90, 20, 0.3, goal=True),
        _shot(1, 10, 80, 50, 0.1, on_target=False),
        _shot(2, 10, 92, 70, 0.4, situation="FromCorner"),
        _shot(2, 10, 95, 50, 0.9, outcome="OwnGoal"),
        _shot(1, 11, 88, 55, 0.2),
    ]
    agg = aggregate_team(events, [1], [10, 11])
    assert agg["n"] == 2
    assert agg["shots_for_total"] == 3 and agg["shots_against_total"] == 1
    assert agg["sot_for_total"] == 2 and agg["goals_for_total"] == 1
    assert abs(agg["xg_against_total"] - 0.4) < 1e-9          # gol contra fora
    assert agg["lane_for_total"]["left"] == 0.3 and agg["lane_against_total"]["right"] == 0.4
    assert agg["sp_share_against"] == 1.0                      # o único chute sofrido veio de escanteio


def _team_events(team_id, opp_id, n_matches, shots_for, shots_against, base_match):
    events = []
    for i in range(n_matches):
        mid = base_match + i
        for k in range(shots_for):
            events.append(_shot(team_id, mid, 85 + k % 8, 20 + 10 * (k % 5), 0.12, goal=(k == 0 and i % 2 == 0)))
        for k in range(shots_against):
            events.append(_shot(opp_id, mid, 88 + k % 6, 65 + 4 * (k % 5), 0.1))
    return events, [base_match + i for i in range(n_matches)][::-1]


def test_build_report_answers_every_question_with_numbers():
    ev_h, ids_h = _team_events(1, 9, 10, 15, 8, 100)
    ev_a, ids_a = _team_events(2, 9, 10, 9, 14, 200)
    agg = {"home": aggregate_team(ev_h, [1], ids_h), "away": aggregate_team(ev_a, [2], ids_a)}
    weak = [{"zone": "own_box", "ratio_vs_league": 1.6, "xga": 3.2, "shots_conceded": 40, "goals_conceded": 5,
             "share_of_xga_pct": 55.0, "trend": "worse", "reliability": "high", "sample_size": 10}]
    insights = {
        "available": True,
        "zones": {"home_team_weaknesses": [], "away_team_weaknesses": weak},
        "goalkeepers": {"home": {"name": "Casa GK", "goal_factor": 0.92}, "away": {"name": "Fora GK", "goal_factor": 1.08}},
        "predictions": [
            {"player_id": 7, "player_name": "Camisa 9", "venue": "home", "target": "goal", "probability": 0.41,
             "shots_per_match": 3.1, "xg_per_match": 0.62, "expected_minutes": 88, "confidence": "high",
             "positive_factors": [{"factor": "3,1 chutes por jogo"}], "zone_opportunities": [{"zone": "central_box", "opportunity_score": 0.2}]},
            {"player_id": 7, "player_name": "Camisa 9", "venue": "home", "target": "goal_involvement", "probability": 0.55,
             "rate_per_match": 0.9, "shots_per_match": 3.1, "xg_per_match": 0.62, "positive_factors": [], "zone_opportunities": []},
        ],
    }
    league = {"xg_per_team_match": 1.4, "lane_xg_pm": {"left": 0.5, "center": 0.5, "right": 0.4}, "matches": 120}
    match = {"id": 1, "home": {"id": 1, "name": "Casa", "logo_url": None}, "away": {"id": 2, "name": "Fora", "logo_url": None}}
    report = build_report(match, insights, agg, league, [{"home_id": 1, "home_score": 2, "away_score": 1},
                                                          {"home_id": 2, "home_score": 0, "away_score": 0}])

    est = report["estimates"]
    assert est["expected_goals"]["home"] > est["expected_goals"]["away"]
    assert abs(sum(est["outcome"].values()) - 1.0) < 0.01
    assert est["expected_shots"]["home"]["low"] <= est["expected_shots"]["home"]["mean"] <= est["expected_shots"]["home"]["high"]
    assert report["shots_conceded"]["more"] == "away"
    assert report["defensive_weaknesses"]["away"][0]["zone"] == "own_box"
    assert report["attack_sides"]["home"]["best"] in ("left", "center", "right")
    assert report["key_players"]["home"][0]["name"] == "Camisa 9"
    assert report["key_players"]["home"][0]["xg_share_pct"] is not None
    assert report["trends"]["h2h"]["matches"] == 2
    assert report["factors"]["home"] and report["factors"]["home"][0]["impact"] >= report["factors"]["home"][-1]["impact"]
    assert report["headline"]["favorite"] == "home"
    assert report["estimates"]["sensitivity"]["focus"] == "home"
    assert report["estimates"]["sensitivity"]["conservative"] <= report["estimates"]["sensitivity"]["favorable"]
    assert all(t["direction"] in ("up", "down", "stable") for t in report["trends"]["home"])
    assert report["conclusion"]["bullets"][0] == report["headline"]["text"]
