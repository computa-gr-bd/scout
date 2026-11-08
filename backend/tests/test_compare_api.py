"""Endpoints de comparação de jogadores e relatório pré-jogo: validação e casos sem dados."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app as fastapi_app

SQLITE_URL = "sqlite:///./test_compare_api.db"


@pytest.fixture(autouse=True)
def _setup():
    engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    sess = sessionmaker(autocommit=False, autoflush=False, bind=engine)()

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


def test_compare_rejects_malformed_and_too_many_entries():
    assert client.get("/api/compare/players", params={"entries": "abc"}).status_code == 400
    assert client.get("/api/compare/players", params={"entries": "1:x"}).status_code == 400
    assert client.get("/api/compare/players", params={"entries": "1,2,3,4,5"}).status_code == 400
    assert client.get("/api/compare/similar", params={"player_id": 1, "scope": "mundo"}).status_code == 422


def test_compare_unknown_player_is_unavailable_not_an_error():
    r = client.get("/api/compare/players", params={"entries": "999"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and body["players"] == []


def test_compare_rejects_invalid_template():
    r = client.get("/api/compare/players", params={"entries": "999", "template": "XYZ"})
    assert r.status_code == 400


def test_similar_unknown_player_is_unavailable():
    r = client.get("/api/compare/similar", params={"player_id": 999})
    assert r.status_code == 200
    assert r.json()["available"] is False and r.json()["items"] == []


def test_match_report_404_for_unknown_match():
    assert client.get("/api/matches/999/report").status_code == 404
