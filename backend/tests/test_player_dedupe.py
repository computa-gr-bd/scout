"""Jogadores repetidos entre fontes (Understat × football-data) viram um só na lista."""
from app.services.player_dedupe import (
    PRow, best_position, group_players, longest_name, team_groups,
)

TEAMS = [(1, "Arsenal"), (2, "Arsenal FC"), (3, "Leeds"), (4, "Leeds United FC"), (5, "Chelsea")]


def _index(rows):
    return group_players(rows, team_groups(TEAMS))


def test_team_groups_join_sources_of_same_club():
    g = team_groups(TEAMS)
    assert g[1] == g[2] and g[3] == g[4]
    assert len({g[1], g[3], g[5]}) == 3


def test_single_name_matches_with_same_numbers():
    rows = [
        PRow(10, 1, "Gabriel", None, None, (8, 720, 1, 0), 30.0),
        PRow(11, 1, "Gabriel Jesus", None, None, (6, 400, 2, 1), 20.0),
        PRow(20, 2, "Gabriel Magalhães", "Defence", None, (8, 720, 1, 0), 0.0),
        PRow(21, 2, "Gabriel Jesus", "Offence", None, (6, 400, 2, 1), 0.0),
    ]
    ix = _index(rows)
    assert ix.canonical_of[20] == 10 and ix.canonical_of[21] == 11
    assert ix.members[10] == [10, 20]


def test_same_full_name_merges_and_keeps_stats_row():
    rows = [
        PRow(30, 3, "Gabriel Gudmundsson", None, None, (6, 525, 0, 1), 12.0),
        PRow(40, 4, "Gabriel Gudmundsson", "Defence", None, (0, 0, 0, 0), 0.0),
    ]
    ix = _index(rows)
    assert ix.canonical_of[40] == 30


def test_ambiguous_single_name_is_not_merged():
    rows = [
        PRow(1, 1, "Gabriel", None, None, (8, 700, 1, 0), 30.0),
        PRow(2, 2, "Gabriel Jesus", "Offence", None, (5, 300, 0, 0), 0.0),
        PRow(3, 2, "Gabriel Martinelli", "Offence", None, (5, 300, 0, 0), 0.0),
    ]
    assert not _index(rows).canonical_of


def test_goalkeeper_never_merges_with_outfield():
    rows = [PRow(1, 1, "Rayan", "GK", None, None, 1.0), PRow(2, 2, "Rayan Cherki", "Offence", None, None, 0.0)]
    assert not _index(rows).canonical_of


def test_other_club_is_untouched():
    rows = [PRow(1, 1, "Cole Palmer", None, None, None, 0.0), PRow(2, 5, "Cole Palmer", "Midfield", None, None, 0.0)]
    assert not _index(rows).canonical_of


def test_position_and_name_pick_the_most_specific():
    assert best_position([None, "D S", "Defence"]) == "Defence"
    assert best_position(["D S", "Centre-Back", "Defence"]) == "Centre-Back"
    assert longest_name(["Gabriel", "Gabriel Magalhães"]) == "Gabriel Magalhães"
