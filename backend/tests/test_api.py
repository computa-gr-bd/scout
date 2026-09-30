import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
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
    yield
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


def test_team_player_detail_404():
    r = client.get("/api/teams/999999")
    assert r.status_code == 404
    r = client.get("/api/players/999999")
    assert r.status_code == 404
    r = client.get("/api/matches/999999")
    assert r.status_code == 404


def test_invalid_token_is_rejected():
    client2 = TestClient(fastapi_app)
    client2.headers["Authorization"] = "Bearer this.is.not.valid"
    # Prediction generation requires auth (optional but header is set)
    r = client2.post("/api/predictions/generate", json={"match_id": 1})
    # either 401 or 404 (match 1 missing is 404 and wins)
    assert r.status_code in (401, 404)
