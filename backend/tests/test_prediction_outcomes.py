"""Partidas encerradas: cada estimativa é marcada com o que aconteceu de fato."""
from app.services.shot_insights import attach_outcomes


def _pred(pid, name, target, venue="home"):
    return {"player_id": pid, "player_name": name, "target": target, "venue": venue}


def _side(rows, assists=None):
    return {"rows": rows, "assists": assists or {}}


def test_outcomes_by_target():
    rows = {1: {"name": "Matthis Abline", "shots": 3, "on_target": 2, "goals": 1, "assists": 0}}
    preds = [_pred(1, "Matthis Abline", t) for t in ("shot", "shot_on_target", "goal", "goal_involvement")]
    attach_outcomes(preds, {"home": _side(rows)})
    assert [p["outcome"]["count"] for p in preds] == [3, 2, 1, 1]
    assert all(p["outcome"]["happened"] for p in preds)


def test_player_without_shots_is_no():
    preds = [_pred(9, "Fulano Reserva", "shot"), _pred(9, "Fulano Reserva", "goal")]
    attach_outcomes(preds, {"home": _side({})})
    assert all(p["outcome"] == {"happened": False, "count": 0} for p in preds)


def test_assist_counts_for_goal_involvement_without_shots():
    preds = [_pred(5, "Achraf Hakimi", "goal_involvement"), _pred(5, "Achraf Hakimi", "goal")]
    attach_outcomes(preds, {"home": _side({}, {"achraf hakimi": 1})})
    assert preds[0]["outcome"]["happened"] is True
    assert preds[1]["outcome"]["happened"] is False


def test_same_player_other_id_matches_by_name():
    rows = {77: {"name": "Désiré Doué", "shots": 2, "on_target": 1, "goals": 0, "assists": 0}}
    preds = [_pred(1, "Desire Doue", "shot")]
    attach_outcomes(preds, {"home": _side(rows)})
    assert preds[0]["outcome"] == {"happened": True, "count": 2}
