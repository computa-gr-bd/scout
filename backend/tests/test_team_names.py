"""Nomes de times: o mesmo clube casa entre fontes, clubes diferentes não se misturam."""
import pytest

from app.services.studio import _same_team_name, norm_team


@pytest.mark.parametrize("a,b", [
    ("Paris FC", "Paris FC"),
    ("Paris FC", "Paris F.C."),
    ("Inter", "FC Internazionale Milano"),
    ("Atletico Madrid", "Club Atlético de Madrid"),
    ("Tottenham", "Tottenham Hotspur FC"),
    ("Lyon", "Olympique Lyonnais"),
    ("Rennes", "Stade Rennais FC 1901"),
    ("RasenBallsport Leipzig", "RB Leipzig"),
    ("Borussia M.Gladbach", "Borussia Mönchengladbach"),
    ("Mainz 05", "1. FSV Mainz 05"),
])
def test_same_club(a, b):
    assert _same_team_name(norm_team(a), norm_team(b))


@pytest.mark.parametrize("a,b", [
    ("Paris FC", "Paris Saint-Germain FC"),
    ("Paris FC", "Paris Saint Germain"),
    ("AC Milan", "FC Internazionale Milano"),
    ("Aston Villa", "Villarreal CF"),
    ("Manchester United", "Manchester City FC"),
    ("Real Madrid", "Real Sociedad"),
])
def test_different_clubs(a, b):
    assert not _same_team_name(norm_team(a), norm_team(b))
