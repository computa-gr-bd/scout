"""Regressão: goleiro na zaga / zagueiro no gol (abreviações do ESPN não reconhecidas)."""
import pytest

from app.services.lineups import _line_of, _place


@pytest.mark.parametrize("pos,line", [
    ("G", "GK"), ("GK", "GK"), ("Goalkeeper", "GK"),
    ("CD-L", "DEF"), ("CD-R", "DEF"), ("CD", "DEF"), ("LB", "DEF"), ("RB", "DEF"), ("SW", "DEF"),
    ("DM", "MID"), ("CM-L", "MID"), ("AM", "MID"), ("LM", "MID"),
    ("LW", "ATT"), ("RW", "ATT"), ("F", "ATT"), ("CF-R", "ATT"),
    ("D M S", "DEF"), ("Left Back", "DEF"), ("Center Defensive Midfield", "MID"),
])
def test_line_of_recognizes_espn_and_understat_codes(pos, line):
    assert _line_of(pos) == line


def _p(name, pos, shirt, player_pos=None):
    return {"player_name": name, "is_starter": True, "position": pos,
            "player_position": player_pos, "stats_position": None, "shirt_number": shirt}


def _xi(gk):
    return [gk] + [_p(f"d{i}", "CD", i + 2) for i in range(4)] \
        + [_p(f"m{i}", "CM", i + 10) for i in range(3)] + [_p(f"f{i}", "F", i + 20) for i in range(3)]


def test_goalkeeper_goes_to_goal_slot():
    placed = _place({"home": _xi(_p("Baumann", "G", 1)), "away": []}, "home")
    gk = [e for e in placed if e["line"] == "GK"]
    assert [e["player_name"] for e in gk] == ["Baumann"]
    assert all(e["line"] != "GK" or e["pitch_x"] == 8 for e in placed)


def test_goalkeeper_without_match_position_uses_shirt_or_squad_position():
    by_shirt = _place({"home": _xi(_p("Baumann", None, 1)), "away": []}, "home")
    assert next(e for e in by_shirt if e["line"] == "GK")["player_name"] == "Baumann"
    by_squad = _place({"home": _xi(_p("Keeper", None, 31, "Goalkeeper")), "away": []}, "home")
    assert next(e for e in by_squad if e["line"] == "GK")["player_name"] == "Keeper"


def test_outfield_player_never_fills_goal_slot():
    xi = [_p(f"d{i}", "CD", i) for i in range(4)] + [_p(f"m{i}", "CM", i + 10) for i in range(3)] \
        + [_p(f"f{i}", "F", i + 20) for i in range(4)]
    assert not [e for e in _place({"home": xi, "away": []}, "home") if e["line"] == "GK"]
