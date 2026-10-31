from app.services.shot_insights import _predictions_for_team


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
