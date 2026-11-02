"""Estatísticas derivadas (goleiro / defesa em campo) e preenchimento de posição — partes puras."""
from app.services.backfill_positions import pick_position
from app.services.derived_stats import Participation, build_derived


def _p(pid, role, minutes, ga, sot=5, goals_from_shots=None, xga=1.2, xgot=1.0, shots=11, starter=True, season=1):
    return Participation(
        player_id=pid, season_id=season, role=role, minutes=minutes, is_starter=starter, xga=xga,
        shots_against=shots, sot_against=sot, xgot_against=xgot,
        goals_from_shots_against=ga if goals_from_shots is None else goals_from_shots, goals_against=ga,
    )


def test_goalkeeper_totals_use_full_matches_only():
    out = build_derived([
        _p(1, "GK", 90, ga=1, sot=5, xgot=1.4),
        _p(1, "GK", 90, ga=0, sot=3, xgot=0.6),
        _p(1, "GK", 30, ga=3, sot=8),                 # entrou no fim: não atribui o jogo inteiro a ele
    ])[(1, 1)]
    assert out["gk_matches"] == 2 and out["gk_minutes"] == 180
    assert out["gk_sota"] == 8 and out["gk_saves"] == 7 and out["gk_ga"] == 1
    assert out["gk_clean_sheets"] == 1 and abs(out["gk_xgot"] - 2.0) < 1e-9


def test_goalkeeper_starter_without_minutes_counts_as_full_match():
    out = build_derived([_p(1, "GK", None, ga=2, sot=4, goals_from_shots=2)])[(1, 1)]
    assert out["gk_matches"] == 1 and out["gk_saves"] == 2
    # reserva sem minutos conhecidos não entra
    assert build_derived([_p(2, "GK", None, ga=0, starter=False)]) == {}


def test_own_goal_counts_in_goals_against_but_not_as_a_save_miss():
    out = build_derived([_p(1, "GK", 90, ga=2, sot=3, goals_from_shots=1)])[(1, 1)]
    assert out["gk_ga"] == 2 and out["gk_saves"] == 2        # 3 no alvo − 1 gol de chute


def test_on_pitch_defense_is_weighted_by_minutes():
    out = build_derived([
        _p(7, "DEF", 90, ga=1, xga=1.0, shots=10),
        _p(7, "DEF", 45, ga=2, xga=2.0, shots=20),          # metade do jogo -> peso 0,5
        _p(7, "DEF", 10, ga=5, xga=5.0, shots=50),          # < 20 min: ignorado
    ])[(7, 1)]
    assert abs(out["onp_90s"] - 1.5) < 1e-9
    assert abs(out["onp_xga"] - 2.0) < 1e-9 and abs(out["onp_ga"] - 2.0) < 1e-9
    assert abs(out["onp_shots_against"] - 20.0) < 1e-9


def test_pick_position_prefers_understat_then_lineups_then_gk_stats():
    assert pick_position("D M S", ["GK"]) == "D M S"
    assert pick_position(None, ["CB", "CB", "LB", "DM"]) == "DF"
    assert pick_position("S", ["RW", "ST", "ST"]) == "FW"      # "S" (reserva) não é posição
    assert pick_position(None, [], has_goalkeeper_stats=True) == "GK"
    assert pick_position(None, [None]) is None
