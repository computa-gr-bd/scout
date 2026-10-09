"""team_id filtering on matches/players + squad link from football-data sync."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app as fastapi_app
from app.db.models import Match, Player, Season, Competition, Team, DataSource
from app.services.data_sync import ingest_competition, ingestion_session


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
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
    fastapi_app.dependency_overrides.pop(get_db, None)
    sess.close()
    engine.dispose()


client = TestClient(fastapi_app)


@pytest.fixture
def seeded(db_session):
    comp = Competition(external_id="10", name="Liga", code="LGA", type="league",
                       data_source=DataSource.FOOTBALL_DATA)
    db_session.add(comp)
    db_session.flush()
    season = Season(competition_id=comp.id, name="2026", current=True,
                    data_source=DataSource.FOOTBALL_DATA)
    db_session.add(season)
    db_session.flush()
    home = Team(external_id="1", name="Alpha FC", data_source=DataSource.FOOTBALL_DATA)
    away = Team(external_id="2", name="Beta FC", data_source=DataSource.FOOTBALL_DATA)
    db_session.add_all([home, away])
    db_session.flush()
    now = datetime.utcnow()
    db_session.add_all([
        Match(season_id=season.id, home_team_id=home.id, away_team_id=away.id,
              kickoff_time=now + timedelta(days=3), status="scheduled",
              data_source=DataSource.FOOTBALL_DATA),
        Match(season_id=season.id, home_team_id=away.id, away_team_id=home.id,
              kickoff_time=now - timedelta(days=3), status="finished",
              home_score=1, away_score=0, data_source=DataSource.FOOTBALL_DATA),
        Match(season_id=season.id, home_team_id=away.id, away_team_id=away.id,
              kickoff_time=now + timedelta(days=5), status="scheduled",
              data_source=DataSource.FOOTBALL_DATA),
    ])
    db_session.add_all([
        Player(external_id="10", last_name="Jogador Alfa", team_id=home.id,
               data_source=DataSource.FOOTBALL_DATA),
        Player(external_id="11", last_name="Jogador Beta", team_id=away.id,
               data_source=DataSource.FOOTBALL_DATA),
        Player(external_id="12", last_name="Sem Clube", data_source=DataSource.FOOTBALL_DATA),
    ])
    db_session.commit()
    return {"home": home.id, "away": away.id, "season": season.id}


def test_upcoming_matches_respect_team_filter(seeded):
    r = client.get("/api/matches", params={"scope": "upcoming", "team_id": seeded["home"], "limit": 50})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    ids = {rows[0]["home_team"]["id"], rows[0]["away_team"]["id"]}
    assert seeded["home"] in ids


def test_all_matches_respect_team_filter(seeded):
    r = client.get("/api/matches", params={"scope": "all", "team_id": seeded["home"], "limit": 50})
    assert r.status_code == 200
    rows = r.json()
    # home has 2 matches (upcoming + recent); the away-vs-away game is excluded
    assert len(rows) == 2
    for m in rows:
        assert seeded["home"] in {m["home_team"]["id"], m["away_team"]["id"]}


def test_recent_matches_respect_team_filter(seeded):
    r = client.get("/api/matches", params={"scope": "recent", "team_id": seeded["home"], "limit": 50})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["status"] == "finished"


def test_players_filter_by_team(seeded):
    r = client.get("/api/players", params={"team_id": seeded["home"], "limit": 50})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["last_name"] == "Jogador Alfa"
    assert rows[0]["team_id"] == seeded["home"]


def test_players_without_team_still_listable(seeded):
    r = client.get("/api/players", params={"limit": 50})
    assert r.status_code == 200
    assert len(r.json()) == 3


def test_squad_ingest_links_player_to_team():
    season = {"id": 20, "startDate": "2026-01-01", "endDate": "2026-12-31"}
    home = {"id": 1, "name": "A", "shortName": "AA",
            "squad": [{"id": 50, "name": "Atleta A", "position": "Goalkeeper"}]}
    away = {"id": 2, "name": "B"}
    payload = {
        "competition": {"id": 10, "name": "League", "code": "BSA", "type": "LEAGUE",
                        "currentSeason": season},
        "teams": {"season": season, "teams": [home, away]},
        "matches": {"matches": []},
        "standings": {"season": season, "standings": [{
            "type": "TOTAL", "table": [{"team": home, "position": 1,
                                        "playedGames": 0, "points": 0}],
        }]},
    }
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with ingestion_session(factory) as db:
            ingest_competition(db, payload)
        with factory() as db:
            team = db.scalar(select(Team).where(Team.external_id == "1"))
            player = db.scalar(select(Player).where(Player.external_id == "50"))
            assert player is not None
            assert player.team_id == team.id
    finally:
        engine.dispose()
