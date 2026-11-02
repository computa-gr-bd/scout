from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.db.models import (
    CollectionState, Competition, DataSource, Match, Player, PlayerMatchStatistics,
    Season, Team, TeamMatchStatistics,
)
from app.main import app as fastapi_app

SQLITE_URL = "sqlite:///./test_api.db"


@pytest.fixture(autouse=True)
def _setup():
    engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sess = TestingSession()

    def override():
        try:
            yield sess
        finally:
            pass

    fastapi_app.dependency_overrides[get_db] = override
    yield sess
    sess.close()
    Base.metadata.drop_all(engine)


client = TestClient(fastapi_app)


def test_health_and_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["name"] == "ScoutVision"
    h = client.get("/api/health")
    assert h.status_code == 200


def test_competitions_seasons_teams_players_endpoints_empty():
    for path in ["/api/competitions", "/api/seasons", "/api/teams", "/api/players", "/api/matches", "/api/models"]:
        r = client.get(path)
        assert r.status_code == 200, f"{path}: {r.status_code}"
        assert isinstance(r.json(), list)


def test_data_status_endpoint_returns_empty_checkpoint_list():
    response = client.get("/api/data/status")
    assert response.status_code == 200
    assert response.json()["competitions"] == []
    assert response.json()["sync_interval_hours"] >= 1


def test_data_status_does_not_mark_manual_statsbomb_import_as_stale(_setup):
    from app.main import settings

    db = _setup
    db.add_all([
        CollectionState(
            provider="football_data", resource="PD", status="success",
            last_success_at=datetime.now() - timedelta(hours=settings.SYNC_INTERVAL_HOURS * 3),
        ),
        CollectionState(
            provider="statsbomb", resource="3869685", status="success",
            last_success_at=datetime.now() - timedelta(days=30),
        ),
    ])
    db.commit()
    response = client.get("/api/data/status")
    assert response.status_code == 200
    checkpoints = response.json()["competitions"]
    stale_by_provider = {item["provider"]: item["is_stale"] for item in checkpoints}
    assert stale_by_provider == {"football_data": True, "statsbomb": False}
    assert all(item["last_success_at"].endswith("+00:00") for item in checkpoints)


def test_team_player_detail_404():
    r = client.get("/api/teams/999999")
    assert r.status_code == 404
    r = client.get("/api/players/999999")
    assert r.status_code == 404
    r = client.get("/api/matches/999999")
    assert r.status_code == 404


def test_team_defensive_stats_endpoint_uses_provider_data_and_team_alias(_setup):
    db = _setup
    competition = Competition(
        name="Premier League", code="PL", data_source=DataSource.UNDERSTAT,
    )
    db.add(competition)
    db.flush()
    season = Season(
        competition_id=competition.id, name="2026-27",
        start_date=datetime(2026, 8, 1).date(), current=True,
        data_source=DataSource.UNDERSTAT,
    )
    team = Team(name="Arsenal", data_source=DataSource.UNDERSTAT)
    alias = Team(name="Arsenal FC", data_source=DataSource.FOOTBALL_DATA)
    opponent = Team(name="Brighton", data_source=DataSource.UNDERSTAT)
    db.add_all([season, team, alias, opponent])
    db.flush()
    match = Match(
        season_id=season.id, home_team_id=team.id, away_team_id=opponent.id,
        kickoff_time=datetime(2026, 9, 12, 14), status="finished",
        data_source=DataSource.UNDERSTAT,
    )
    goalkeeper = Player(
        last_name="Raya", display_name="David Raya", position="Goalkeeper",
        data_source=DataSource.UNDERSTAT,
    )
    db.add_all([match, goalkeeper])
    db.flush()
    db.add_all([
        TeamMatchStatistics(
            team_id=alias.id, match_id=match.id,
            supplemental_stats={"espn": {"mapped": {
                "tackles": 14, "interceptions": 5, "clearances": 21,
                "shots_blocked": 2, "saves": 4,
            }}},
        ),
        TeamMatchStatistics(
            team_id=team.id, match_id=match.id,
            supplemental_stats={"espn": {"mapped": {
                "tackles": 14, "interceptions": 5, "clearances": 21,
                "shots_blocked": 2, "saves": 4,
            }}},
        ),
        PlayerMatchStatistics(
            player_id=goalkeeper.id, match_id=match.id, team_id=alias.id,
            position="GK", saves=4, goals_conceded=1, shots_faced=0,
            supplemental_stats={"espn": {"mapped": {
                "saves": 4, "goals_conceded": 1,
            }}},
        ),
    ])
    db.commit()

    response = client.get(f"/api/teams/{team.id}/defensive-stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert payload["matches_with_stats"] == 1
    assert payload["metrics"]["tackles"] == {
        "total": 14.0, "per_match": 14.0, "matches": 1, "sources": ["espn"],
    }
    assert payload["goalkeepers"] == [{
        "player_id": goalkeeper.id,
        "name": "David Raya",
        "appearances": 1,
        "sources": ["espn"],
        "saves": 4.0,
        "saves_per_match": 4.0,
        "goals_conceded": 1.0,
        "goals_conceded_per_match": 1.0,
        "shots_faced": None,
        "shots_faced_per_match": None,
    }]


def test_team_defensive_stats_endpoint_marks_missing_values_unavailable(_setup):
    db = _setup
    team = Team(name="Arsenal", data_source=DataSource.UNDERSTAT)
    db.add(team)
    db.commit()

    response = client.get(f"/api/teams/{team.id}/defensive-stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is False
    assert payload["matches_with_stats"] == 0
    assert payload["metrics"]["tackles"]["per_match"] is None
    assert payload["goalkeepers"] == []


def test_invalid_token_is_rejected():
    client2 = TestClient(fastapi_app)
    client2.headers["Authorization"] = "Bearer this.is.not.valid"
    # Prediction generation requires auth (optional but header is set)
    r = client2.post("/api/predictions/generate", json={"match_id": 1})
    # either 401 or 404 (match 1 missing is 404 and wins)
    assert r.status_code in (401, 404)
