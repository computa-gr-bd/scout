"""Lista de jogadores restrita às 5 ligas, time atual, zonas derivadas dos chutes e /overview."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app as fastapi_app
from app.db.models import (
    Competition, DataSource, Event, EventPosition, EventType, Match, Player, PlayerMatchStatistics, PlayerStatistics,
    Season, Shot, Team, TeamStatistics,
)
from app.services.player_profile import pitchapi_match_summaries, zone_for_point


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sess = sessionmaker(autocommit=False, autoflush=False, bind=engine)()

    def override():
        try:
            yield sess
        finally:
            pass

    fastapi_app.dependency_overrides[get_db] = override
    yield sess
    fastapi_app.dependency_overrides.pop(get_db, None)
    sess.close()
    engine.dispose()


client = TestClient(fastapi_app)


@pytest.fixture
def world(db_session):
    s = db_session
    pl = Competition(external_id="2021", name="Premier League", code="PL", type="league",
                     data_source=DataSource.FOOTBALL_DATA)
    other = Competition(external_id="9999", name="Liga Qualquer", code="XYZ", type="league",
                        data_source=DataSource.FOOTBALL_DATA)
    s.add_all([pl, other])
    s.flush()
    season_pl = Season(competition_id=pl.id, name="2026", current=True, data_source=DataSource.FOOTBALL_DATA)
    season_x = Season(competition_id=other.id, name="2026", current=True, data_source=DataSource.FOOTBALL_DATA)
    s.add_all([season_pl, season_x])
    s.flush()
    arsenal = Team(external_id="1", name="Arsenal", short_name="ARS", data_source=DataSource.FOOTBALL_DATA)
    chelsea = Team(external_id="2", name="Chelsea", short_name="CHE", data_source=DataSource.FOOTBALL_DATA)
    outsider = Team(external_id="3", name="Fora FC", data_source=DataSource.FOOTBALL_DATA)
    s.add_all([arsenal, chelsea, outsider])
    s.flush()
    s.add_all([
        TeamStatistics(team_id=arsenal.id, season_id=season_pl.id, scope="overall"),
        TeamStatistics(team_id=chelsea.id, season_id=season_pl.id, scope="overall"),
        TeamStatistics(team_id=outsider.id, season_id=season_x.id, scope="overall"),
    ])
    striker = Player(external_id="10", last_name="Striker", display_name="Gabriel Striker", position="F S",
                     team_id=arsenal.id, data_source=DataSource.UNDERSTAT)
    keeper = Player(external_id="11", last_name="Keeper", display_name="Keeper", position="GK",
                    team_id=chelsea.id, data_source=DataSource.UNDERSTAT)
    stranger = Player(external_id="12", last_name="Stranger", position="F",
                      team_id=outsider.id, data_source=DataSource.FOOTBALL_DATA)
    free = Player(external_id="13", last_name="Livre", position="M", data_source=DataSource.FOOTBALL_DATA)
    s.add_all([striker, keeper, stranger, free])
    s.flush()
    s.add(PlayerStatistics(player_id=striker.id, season_id=season_pl.id, scope="overall",
                           matches_played=10, minutes_played=900, starts=10, goals=8, assists=2,
                           shots=40, xg_total=6.5, xa_total=1.2, goals_per_90=0.8, xg_per_90=0.65,
                           recent_form={"npg": 7, "npxg": 5.4, "xg_chain": 9.0, "xg_buildup": 3.0,
                                        "yellow_cards": 1, "red_cards": 0}))
    now = datetime.utcnow()
    past = Match(season_id=season_pl.id, home_team_id=arsenal.id, away_team_id=chelsea.id,
                 kickoff_time=now - timedelta(days=7), status="finished", home_score=2, away_score=1)
    future = Match(season_id=season_pl.id, home_team_id=chelsea.id, away_team_id=arsenal.id,
                   kickoff_time=now + timedelta(days=5), status="scheduled")
    s.add_all([past, future])
    s.flush()
    for x, y, xg, goal in [(95.0, 50.0, 0.4, True), (90.0, 45.0, 0.2, False), (80.0, 30.0, 0.05, False)]:
        ev = Event(match_id=past.id, team_id=arsenal.id, player_id=striker.id, type=EventType.SHOT,
                   minute=30, data_source=DataSource.UNDERSTAT)
        ev.position = EventPosition(x=x, y=y)
        ev.shot = Shot(on_target=goal, is_goal=goal, xg=xg)
        s.add(ev)
    s.commit()
    return {"striker": striker.id, "keeper": keeper.id, "stranger": stranger.id, "free": free.id,
            "arsenal": arsenal.id, "future": future.id}


def test_zone_for_point_covers_pitch():
    assert zone_for_point(95, 50).value == "central_box"
    assert zone_for_point(50, 50).value == "neutral_midfield"
    # buraco entre retângulos cai na zona mais próxima, sem estourar
    assert zone_for_point(88, 19) is not None


def test_player_overview_shows_partial_pitchapi_stats_without_double_counting(world, db_session):
    match = db_session.query(Match).filter(Match.status == "finished").one()
    mirror = Match(
        season_id=match.season_id, home_team_id=match.home_team_id, away_team_id=match.away_team_id,
        kickoff_time=match.kickoff_time, status="finished", canonical_match_id=match.id,
        data_source=DataSource.PITCH_API,
    )
    db_session.add(mirror)
    db_session.flush()
    db_session.add_all([
        PlayerMatchStatistics(
            player_id=world["striker"], match_id=match.id, team_id=world["arsenal"],
            supplemental_stats={"pitchapi": {"mapped": {"minutes_played": 90, "goals": 1, "shots": 2}}},
        ),
        PlayerMatchStatistics(
            player_id=world["striker"], match_id=mirror.id, team_id=world["arsenal"],
            supplemental_stats={"pitchapi": {"mapped": {"goals": 1}}},
        ),
    ])
    db_session.commit()

    response = client.get(f"/api/players/{world['striker']}/overview")
    assert response.status_code == 200
    summary = response.json()["pitchapi_summary"]
    assert summary["matches"] == 1
    assert summary["totals"]["goals"] == {"value": 1, "matches": 1}
    assert summary["totals"]["minutes_played"] == {"value": 90, "matches": 1}
    assert "assists" not in summary["totals"]

    mirror_stats = db_session.query(PlayerMatchStatistics).filter_by(match_id=mirror.id).one()
    mirror_stats.supplemental_stats = {"pitchapi": {"mapped": {"goals": 2}}}
    db_session.commit()
    assert client.get(f"/api/players/{world['striker']}/overview").json()["pitchapi_summary"] is None


def test_list_exposes_partial_pitchapi_totals_without_replacing_season_stats(world, db_session):
    match = db_session.query(Match).filter(Match.status == "finished").one()
    db_session.add_all([
        PlayerMatchStatistics(
            player_id=world["keeper"], match_id=match.id, team_id=match.away_team_id,
            supplemental_stats={"pitchapi": {"mapped": {"minutes_played": 90, "goals": 0}}},
        ),
        PlayerMatchStatistics(
            player_id=world["striker"], match_id=match.id, team_id=match.home_team_id,
            supplemental_stats={"pitchapi": {"mapped": {"minutes_played": 80, "goals": 1}}},
        ),
    ])
    db_session.commit()
    response = client.get("/api/players", params={"top5": True})
    assert response.status_code == 200
    players = {player["id"]: player for player in response.json()}
    keeper = players[world["keeper"]]
    assert keeper["statistics"] == []
    assert keeper["pitchapi_summary"]["matches"] == 1
    assert keeper["pitchapi_summary"]["totals"]["goals"] == {"value": 0, "matches": 1}
    assert "assists" not in keeper["pitchapi_summary"]["totals"]
    assert players[world["striker"]]["statistics"][0]["goals"] == 8
    assert players[world["striker"]]["pitchapi_summary"]["totals"]["goals"]["value"] == 1


def test_pitchapi_summary_groups_aliases_without_mixing_seasons(world, db_session):
    match = db_session.query(Match).filter(Match.status == "finished").one()
    alias = Player(last_name="Alias", team_id=world["arsenal"], data_source=DataSource.FOOTBALL_DATA)
    mirror = Match(
        season_id=match.season_id, home_team_id=match.home_team_id, away_team_id=match.away_team_id,
        kickoff_time=match.kickoff_time, status="finished", canonical_match_id=match.id,
        data_source=DataSource.PITCH_API,
    )
    other_season = Season(competition_id=match.season.competition_id, name="2025", data_source=DataSource.FOOTBALL_DATA)
    db_session.add_all([alias, mirror, other_season])
    db_session.flush()
    old_match = Match(
        season_id=other_season.id, home_team_id=match.home_team_id, away_team_id=match.away_team_id,
        kickoff_time=match.kickoff_time - timedelta(days=365), status="finished",
    )
    db_session.add(old_match)
    db_session.flush()
    db_session.add_all([
        PlayerMatchStatistics(player_id=world["striker"], match_id=match.id, team_id=world["arsenal"],
                              supplemental_stats={"pitchapi": {"mapped": {"goals": 1}}}),
        PlayerMatchStatistics(player_id=alias.id, match_id=mirror.id, team_id=world["arsenal"],
                              supplemental_stats={"pitchapi": {"mapped": {"goals": 1}}}),
        PlayerMatchStatistics(player_id=alias.id, match_id=old_match.id, team_id=world["arsenal"],
                              supplemental_stats={"pitchapi": {"mapped": {"goals": 10}}}),
    ])
    db_session.commit()
    summary = pitchapi_match_summaries(db_session, {world["striker"]: [world["striker"], alias.id]})[world["striker"]]
    assert summary["season_start_year"] == 2026
    assert summary["matches"] == 1
    assert summary["totals"]["goals"] == {"value": 1, "matches": 1}


def test_goal_probability_accepts_understat_metadata_as_recent_form(world, db_session):
    stat = db_session.query(PlayerStatistics).filter_by(player_id=world["striker"]).one()
    team_stat = db_session.query(TeamStatistics).filter_by(team_id=world["arsenal"]).one()
    stat.recent_form = {"position": "FW", "npxg": 2.5}
    team_stat.recent_form = {"understat_team": "Arsenal", "points": 20}
    db_session.commit()
    response = client.get(
        f"/api/players/{world['striker']}/goal-probability",
        params={"opponent_team_id": db_session.get(Match, world["future"]).home_team_id, "venue": "home"},
    )
    assert response.status_code == 200
    assert 0 <= response.json()["probability"] <= 1


def test_default_listing_is_unchanged(world):
    r = client.get("/api/players", params={"limit": 50})
    assert r.status_code == 200
    assert len(r.json()) == 4


def test_top5_only_lists_players_of_top5_teams(world):
    r = client.get("/api/players", params={"top5": True, "limit": 50})
    assert r.status_code == 200
    names = {p["last_name"] for p in r.json()}
    assert names == {"Striker", "Keeper"}


def test_league_filter_and_team_decoration(world):
    r = client.get("/api/players", params={"league": "pl", "limit": 50, "order": "goals"})
    assert r.status_code == 200
    rows = r.json()
    assert rows[0]["last_name"] == "Striker"  # mais gols primeiro
    assert rows[0]["team_name"] == "Arsenal"
    assert rows[0]["league_code"] == "PL"
    assert rows[0]["league_name"] == "Premier League"


def test_invalid_league_is_rejected(world):
    assert client.get("/api/players", params={"league": "XYZ"}).status_code == 400


def test_position_groups(world):
    r = client.get("/api/players", params={"top5": True, "position": "GK", "limit": 50})
    assert [p["last_name"] for p in r.json()] == ["Keeper"]
    r = client.get("/api/players", params={"top5": True, "position": "ATT", "limit": 50})
    assert [p["last_name"] for p in r.json()] == ["Striker"]


def test_player_detail_has_team(world):
    r = client.get(f"/api/players/{world['striker']}")
    assert r.status_code == 200
    assert r.json()["team_name"] == "Arsenal"
    assert r.json()["league_name"] == "Premier League"


def test_zones_are_derived_from_shots_when_missing(world):
    r = client.get(f"/api/players/{world['striker']}/zones")
    assert r.status_code == 200
    zones = r.json()
    assert zones, "deveria derivar zonas dos chutes"
    assert sum(z["shots"] for z in zones) == 3
    assert "central_box" in {z["zone"] for z in zones}
    assert pytest.approx(sum(z["zone_frequency_pct"] for z in zones), abs=0.5) == 100.0
    assert max(z["offensive_strength"] for z in zones) == 1.0


def test_overview_recent_next_match_and_extras(world):
    r = client.get(f"/api/players/{world['striker']}/overview")
    assert r.status_code == 200
    body = r.json()
    assert body["team"]["name"] == "Arsenal"
    assert body["extras"]["yellow_cards"] == 1
    assert body["extras"]["xg_chain_per_90"] == pytest.approx(0.9)
    assert len(body["recent"]) == 1
    assert body["recent"][0]["shots"] == 3
    assert body["recent"][0]["goals"] == 1
    assert body["recent"][0]["opponent"] == "Chelsea"
    assert body["recent"][0]["result"] == "W"
    assert body["next_match"]["match_id"] == world["future"]
    assert body["next_match"]["opponent_name"] == "Chelsea"
    assert body["next_match"]["is_home"] is False


def test_overview_without_team_or_stats_is_empty_not_error(world):
    r = client.get(f"/api/players/{world['free']}/overview")
    assert r.status_code == 200
    body = r.json()
    assert body["recent"] == []
    assert body["next_match"] is None
    assert client.get("/api/players/999999/overview").status_code == 404
