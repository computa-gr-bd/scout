"""Escalação da partida: oficial quando existe, provável XI pelo elenco, + gols."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app as fastapi_app
from app.db.models import (Competition, DataSource, Event, EventType, Goal, Lineup,
                           Match, Player, Season, Team)


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
    """Partida futura (sem lineup) + partida finalizada com lineup e gol."""
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
    upcoming = Match(season_id=season.id, home_team_id=home.id, away_team_id=away.id,
                     kickoff_time=now + timedelta(days=2), status="scheduled",
                     data_source=DataSource.FOOTBALL_DATA)
    finished = Match(season_id=season.id, home_team_id=home.id, away_team_id=away.id,
                     kickoff_time=now - timedelta(days=2), status="finished",
                     home_score=1, away_score=0, data_source=DataSource.FOOTBALL_DATA)
    db_session.add_all([upcoming, finished])
    db_session.flush()

    # Elenco completo 4-3-3 do time da casa + 1 reserva.
    positions = (["Goalkeeper"] + ["Defence"] * 4 + ["Midfield"] * 3
                 + ["Offence"] * 4)
    players = []
    for index, position in enumerate(positions):
        p = Player(external_id=f"h{index}", last_name=f"Alfa {index}",
                   position=position, team_id=home.id,
                   data_source=DataSource.FOOTBALL_DATA)
        players.append(p)
        db_session.add(p)
    db_session.flush()

    # Lineup oficial só na partida finalizada (11 titulares + 1 reserva).
    for index, p in enumerate(players[:11]):
        db_session.add(Lineup(match_id=finished.id, team_id=home.id, player_id=p.id,
                              is_starter=True, shirt_number=index + 1,
                              position=positions[index]))
    db_session.add(Lineup(match_id=finished.id, team_id=home.id,
                          player_id=players[11].id, is_starter=False, shirt_number=12,
                          position="Offence"))
    db_session.flush()

    # Gol do jogador 10 da lista (índice 9 = atacante).
    scorer = players[9]
    event = Event(external_id="g1", match_id=finished.id, team_id=home.id,
                  player_id=scorer.id, type=EventType.GOAL, minute=23,
                  data_source=DataSource.DEMO)
    db_session.add(event)
    db_session.flush()
    db_session.add(Goal(event_id=event.id, scorer_player_id=scorer.id, is_penalty=True))
    db_session.commit()
    return {"upcoming": upcoming.id, "finished": finished.id,
            "home": home.id, "away": away.id, "scorer": scorer.id}


def test_lineups_estimated_from_squad_when_no_official(seeded):
    r = client.get(f"/api/matches/{seeded['upcoming']}/lineups")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "estimated"
    assert body["formation"] == "4-3-3"
    assert len(body["home"]) == 11
    lines = [p["line"] for p in body["home"]]
    assert lines.count("GK") == 1
    assert lines.count("DEF") == 4
    assert lines.count("MID") == 3
    assert lines.count("ATT") == 3
    for p in body["home"]:
        assert p["estimated"] is True
        assert p["player_name"]


def test_lineups_official_used_when_present(seeded):
    r = client.get(f"/api/matches/{seeded['finished']}/lineups")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "official"
    # O reserva não entra no XI.
    assert len(body["home"]) == 11
    assert all(p["estimated"] is False for p in body["home"])
    numbers = sorted(p["shirt_number"] for p in body["home"])
    assert numbers == list(range(1, 12))


def test_lineups_include_goalscorer(seeded):
    body = client.get(f"/api/matches/{seeded['finished']}/lineups").json()
    assert len(body["goals"]) == 1
    goal = body["goals"][0]
    assert goal["minute"] == 23
    assert goal["is_penalty"] is True
    assert goal["scorer_player_id"] == seeded["scorer"]
    assert goal["team_id"] == seeded["home"]


def test_lineups_unknown_match_returns_404(seeded):
    r = client.get("/api/matches/999999/lineups")
    assert r.status_code == 404


def test_h2h_returns_team_names(seeded):
    """A tela caía em 'Time <id>' porque o payload não trazia nomes."""
    r = client.get(f"/api/matches/{seeded['upcoming']}/analysis")
    assert r.status_code == 200
    h2h = r.json()["h2h_recent"]
    # Inclui a própria partida analisada mais o confronto anterior.
    assert len(h2h) == 2
    for row in h2h:
        assert row["home_name"] == "Alpha FC"
        assert row["away_name"] == "Beta FC"
