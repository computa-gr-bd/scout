"""Índices por função, goleiro do time e minutos recentes lidos do banco."""
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.db.models import (
    Competition, DataSource, Lineup, Match, Player, PlayerMatchStatistics, PlayerStatistics, Season, Team,
)
from app.services.index_service import (
    clear_peer_cache, player_index_payload, recent_minutes, team_goalkeeper,
)


@pytest.fixture
def db():
    clear_peer_cache()
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        yield session
    engine.dispose()
    clear_peer_cache()


@pytest.fixture
def world(db):
    comp = Competition(external_id="pl", name="Premier League", code="PL", data_source=DataSource.UNDERSTAT)
    db.add(comp)
    db.flush()
    season = Season(competition_id=comp.id, name="2026", data_source=DataSource.UNDERSTAT)
    db.add(season)
    home = Team(external_id="ars", name="Arsenal", data_source=DataSource.UNDERSTAT)
    away = Team(external_id="bha", name="Brighton", data_source=DataSource.UNDERSTAT)
    db.add_all([home, away])
    db.flush()
    match = Match(
        external_id="m1", season_id=season.id, home_team_id=home.id, away_team_id=away.id,
        kickoff_time=datetime(2026, 9, 12, 14), status="finished", home_score=1, away_score=0,
        data_source=DataSource.UNDERSTAT,
    )
    db.add(match)
    db.flush()
    return {"season": season, "home": home, "away": away, "match": match}


def _player(db, ext, name, position, team):
    p = Player(external_id=ext, last_name=name, display_name=name, position=position,
               team_id=team.id, data_source=DataSource.UNDERSTAT)
    db.add(p)
    db.flush()
    return p


def _gk_stats(db, player, season, saves, sota, ga, psxg, minutes=1800):
    db.add(PlayerStatistics(
        player_id=player.id, season_id=season.id, scope="overall",
        matches_played=minutes // 90, minutes_played=minutes,
        supplemental_stats={"soccerdata": {
            "gk_saves": saves, "gk_sota": sota, "gk_ga": ga, "gk_psxg": psxg, "gk_clean_sheets": 6,
            "gk_crosses_opp": 80, "gk_crosses_stopped": 7, "gk_opa": 20,
            "gk_launched_cmp": 150, "gk_launched_att": 300, "pass_cmp": 500, "pass_att": 700,
        }},
    ))
    db.flush()


def test_goalkeeper_index_uses_fbref_totals(db, world):
    keeper = _player(db, "gk1", "Raya", "GK", world["home"])
    _gk_stats(db, keeper, world["season"], saves=75, sota=100, ga=25, psxg=31)
    out = player_index_payload(db, keeper)
    assert out["role"] == "GK" and out["available"] and 0 <= out["index"] <= 100
    kpis = {k["key"]: k for k in out["kpis"]}
    assert kpis["save_pct"]["unit"] == "%" and kpis["psxg_diff_p90"]["value"] > 0
    assert {c["key"] for c in out["components"]} >= {"shot_stopping", "area_control"}


def test_outfield_player_without_fbref_data_is_not_scored(db, world):
    striker = _player(db, "f1", "Striker", "F M S", world["home"])
    assert player_index_payload(db, striker)["available"] is False
    assert player_index_payload(db, striker)["role"] == "ATT"

    defender = _player(db, "d1", "Defender", "D", world["home"])
    db.add(PlayerStatistics(player_id=defender.id, season_id=world["season"].id, scope="overall",
                            matches_played=10, minutes_played=900))
    db.flush()
    out = player_index_payload(db, defender)
    assert out["role"] == "DEF" and out["available"] is False and out["index"] is None


def test_defender_shows_fbref_tackles_without_unavailable_success_rate(db, world):
    defender = _player(db, "d2", "Catena", "DF", world["home"])
    db.add(PlayerStatistics(
        player_id=defender.id, season_id=world["season"].id, scope="overall",
        matches_played=9, minutes_played=810,
        recent_form={"position": "DF", "xg_buildup": 1.0, "xg_chain": 1.1},
        supplemental_stats={"soccerdata": {
            "tackles": 4, "interceptions": 9, "fouls": 10, "yellow_cards": 2,
        }},
    ))
    db.flush()

    out = player_index_payload(db, defender)

    assert out["available"] is True
    assert "FBref / SoccerData" in out["data_sources"]
    tackle_kpi = next(kpi for kpi in out["kpis"] if kpi["key"] == "tackle_win_pct")
    assert tackle_kpi["value"] == 4
    assert tackle_kpi["unit"] == ""


def test_team_goalkeeper_picks_most_minutes_and_exposes_factor(db, world):
    backup = _player(db, "gk2", "Backup", "GK", world["home"])
    starter = _player(db, "gk3", "Starter", "GK", world["home"])
    _gk_stats(db, backup, world["season"], saves=10, sota=20, ga=10, psxg=9, minutes=270)
    _gk_stats(db, starter, world["season"], saves=140, sota=180, ga=40, psxg=52, minutes=2700)
    gk = team_goalkeeper(db, [world["home"].id])
    assert gk["name"] == "Starter" and gk["has_fbref"] is True
    assert 0.85 <= gk["goal_factor"] < 1.0          # defende acima da média da liga (sem pares: 70%)
    assert team_goalkeeper(db, [world["away"].id]) is None


def test_recent_minutes_counts_missing_matches_as_zero(db, world):
    p = _player(db, "d2", "Rotation", "D", world["home"])
    other = Match(external_id="m0", season_id=world["season"].id, home_team_id=world["home"].id,
                  away_team_id=world["away"].id, kickoff_time=datetime(2026, 9, 5, 14), status="finished",
                  home_score=0, away_score=0, data_source=DataSource.UNDERSTAT)
    third = Match(external_id="m-1", season_id=world["season"].id, home_team_id=world["away"].id,
                  away_team_id=world["home"].id, kickoff_time=datetime(2026, 8, 29, 14), status="finished",
                  home_score=2, away_score=2, data_source=DataSource.UNDERSTAT)
    db.add_all([other, third])
    db.flush()
    db.add(Lineup(match_id=world["match"].id, team_id=world["home"].id, player_id=p.id, minutes_played=90))
    db.add(PlayerMatchStatistics(match_id=other.id, team_id=world["home"].id, player_id=p.id, minutes_played=60))
    db.flush()

    window = [world["match"].id, other.id, third.id]       # mais recente primeiro
    assert recent_minutes(db, [p.id], window) == {p.id: [90, 60, 0]}
    assert recent_minutes(db, [p.id], [world["match"].id]) == {}   # <2 jogos com minutos conhecidos


def test_player_without_position_gets_role_from_understat_recent_form(db, world):
    defender = _player(db, "d9", "Sem Posicao", None, world["home"])
    db.add(PlayerStatistics(
        player_id=defender.id, season_id=world["season"].id, scope="overall",
        matches_played=20, minutes_played=1800, key_passes=12,
        recent_form={"position": "D S", "xg_buildup": 8.0, "xg_chain": 12.0, "yellow_cards": 3, "red_cards": 0},
        supplemental_stats={"derived": {"onp_90s": 20.0, "onp_xga": 21.0, "onp_ga": 19.0, "onp_shots_against": 230.0}},
    ))
    db.flush()
    out = player_index_payload(db, defender)
    assert out["role"] == "DEF" and out["available"] is True
    assert any("Understat" in src for src in out["data_sources"])


def test_goalkeeper_from_derived_shots_only(db, world):
    keeper = _player(db, "gk9", "Derivado", "GK", world["home"])
    db.add(PlayerStatistics(
        player_id=keeper.id, season_id=world["season"].id, scope="overall",
        matches_played=20, minutes_played=1800,
        supplemental_stats={"derived": {"gk_matches": 20, "gk_minutes": 1800, "gk_sota": 90, "gk_saves": 66,
                                         "gk_ga": 24, "gk_xgot": 29.0, "gk_clean_sheets": 8}},
    ))
    db.flush()
    gk = team_goalkeeper(db, [world["home"].id])
    assert gk["has_data"] is True and gk["data_source"] == "derived" and gk["has_fbref"] is False
    assert gk["goal_factor"] is not None and gk["psxg_diff_p90"] > 0
    assert player_index_payload(db, keeper)["available"] is True
