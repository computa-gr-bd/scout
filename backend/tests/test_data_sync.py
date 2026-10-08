from copy import deepcopy
from unittest.mock import Mock

import pytest
import requests
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db import Base
from app.db.models import (
    CollectionState, Competition, DataSource, Event, Match, Player, Season, Standing, Team,
)
from app.services.data_sync import (
    FootballDataClient, entity, ingest_competition, ingestion_session,
    sync_football_data_for_competitions, upsert,
)
from app.services.statsbomb_importer import ingest_match, normalized_location


@pytest.fixture
def factory():
    engine = create_engine("sqlite:///:memory:")
    @event.listens_for(engine, "connect")
    def foreign_keys(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def payload():
    season = {"id": 20, "startDate": "2026-01-01", "endDate": "2026-12-31"}
    home = {"id": 1, "name": "A", "shortName": "AA", "venue": "Estadio A",
            "squad": [{"id": 50, "name": "Atleta A"}]}
    away = {"id": 2, "name": "B"}
    return {
        "competition": {"id": 10, "name": "League", "code": "BSA", "type": "LEAGUE",
                        "currentSeason": season},
        "teams": {"season": season, "teams": [home, away]},
        "matches": {"matches": [{
            "id": 100, "season": season, "homeTeam": {"id": 1, "name": "A"},
            "awayTeam": away, "utcDate": "2026-02-01T12:00:00Z", "status": "TIMED",
            "score": {"fullTime": {"home": None, "away": None}},
        }]},
        "standings": {"season": season, "standings": [{
            "type": "TOTAL", "table": [{"team": home, "position": 1,
                                       "playedGames": 0, "points": 0}],
        }]},
    }


def test_import_repeated_and_corrected(factory, payload):
    with ingestion_session(factory) as db:
        ingest_competition(db, payload)
    with ingestion_session(factory) as db:
        ingest_competition(db, payload)
        assert db.scalar(select(func.count()).select_from(Match)) == 1
        assert db.scalar(select(func.count()).select_from(Team)) == 2
        assert db.scalar(select(func.count()).select_from(Player)) == 1
        assert db.scalar(select(Match)).home_score is None
        assert db.scalar(select(Team).where(Team.external_id == "1")).short_name == "AA"
        assert db.scalar(select(Standing)).points == 0
        assert db.scalar(select(CollectionState)).last_success_at is not None
    payload["matches"]["matches"][0].update(
        status="FINISHED", score={"fullTime": {"home": 2, "away": 0}})
    with ingestion_session(factory) as db:
        ingest_competition(db, payload)
        assert db.scalar(select(Match)).home_score == 2
        assert db.scalar(select(Match)).away_score == 0
    payload["matches"]["matches"][0]["score"]["fullTime"]["home"] = None
    with ingestion_session(factory) as db:
        ingest_competition(db, payload)
        assert db.scalar(select(Match)).home_score is None


def test_provider_identity_is_not_shared(factory, payload):
    with ingestion_session(factory) as db:
        entity(db, Team, DataSource.STATSBOMB, 1, name="Different team")
        ingest_competition(db, payload)
        assert db.scalar(select(func.count()).select_from(Team)) == 3


def test_invalid_data_rolls_back_and_failure_is_recorded(factory, payload):
    client = Mock()
    client.fetch_competition.return_value = payload
    sync_football_data_for_competitions(["BSA"], client=client, factory=factory)
    with factory() as db:
        previous = db.scalar(select(CollectionState)).last_success_at
    payload["teams"]["teams"][0]["name"] = "Should roll back"
    payload["matches"]["matches"][0]["utcDate"] = "bad date"
    with pytest.raises(RuntimeError):
        sync_football_data_for_competitions(["BSA"], client=client, factory=factory)
    with factory() as db:
        assert db.scalar(select(Team).where(Team.external_id == "1")).name == "A"
        state = db.scalar(select(CollectionState))
        assert state.status == "failed"
        assert state.last_success_at == previous


def test_season_validation_and_undefined_teams(factory, payload):
    broken = deepcopy(payload)
    broken["standings"]["season"] = {"id": 99}
    with pytest.raises(ValueError), ingestion_session(factory) as db:
        ingest_competition(db, broken)
    payload["matches"]["matches"][0]["homeTeam"] = {"id": None, "name": None}
    with ingestion_session(factory) as db:
        result = ingest_competition(db, payload)
        assert result["unresolved_matches"] == 1
        assert result["matches"] == 0


def test_pacing_and_retries_without_quota_headers():
    session, sleep = Mock(), Mock()
    session.headers = {}
    session.get.side_effect = [
        Mock(status_code=429, headers={"Retry-After": "1"}),
        Mock(status_code=500, headers={}),
        Mock(status_code=200, json=lambda: {"ok": True}),
    ]
    client = FootballDataClient("test", session=session, sleep=sleep, clock=lambda: 0)
    assert client.get("competitions") == {"ok": True}
    assert client.request_count == 3
    assert any(call.args[0] >= 6 for call in sleep.call_args_list)
    session.get.side_effect = requests.Timeout()
    with pytest.raises(RuntimeError):
        client.get("competitions")


def test_auth_failure_does_not_retry_or_leak_key():
    session = Mock(headers={})
    session.get.return_value = Mock(status_code=403)
    client = FootballDataClient("private-test-token", session=session)
    with pytest.raises(RuntimeError, match="HTTP 403") as exc:
        client.get("competitions/BSA")
    assert "private-test-token" not in str(exc.value)
    assert session.get.call_count == 1


def test_connection_normalization():
    settings = Settings(_env_file=None, DATABASE_URL="postgresql://u:p%40ss@db.neon.tech/neondb")
    assert settings.DATABASE_URL.startswith("postgresql+psycopg://")
    assert "sslmode=require" in settings.DATABASE_URL
    assert "p%40ss" in settings.DATABASE_URL


def test_statsbomb_normalization_reimport_and_penalty_exclusion(factory):
    raw_match = {
        "match_id": 1, "competition": {"competition_id": 43, "competition_name": "Cup"},
        "season": {"season_name": "2022"}, "match_date": "2022-12-18", "kick_off": "15:00:00",
        "home_team": {"home_team_id": 1, "home_team_name": "A"},
        "away_team": {"away_team_id": 2, "away_team_name": "B"},
        "home_score": 1, "away_score": 0, "last_updated": "2023-01-01",
    }
    lineups = [{"team_id": 1, "lineup": [{"player_id": 50, "player_name": "A",
                                        "positions": [{"position": "Center Forward"}]}]}]
    shot = {"id": "shot-1", "team": {"id": 1}, "player": {"id": 50},
            "type": {"name": "Shot"}, "period": 1, "minute": 3, "second": 10,
            "location": [108, 40], "shot": {"statsbomb_xg": .5, "outcome": {"name": "Goal"}}}
    shootout = {**shot, "id": "shootout", "period": 5}
    for _ in range(2):
        with ingestion_session(factory) as db:
            ingest_match(db, raw_match, lineups, [shot, shootout])
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Event)) == 1
        e = db.scalar(select(Event))
        assert e.position.x == pytest.approx(90)
        assert e.position.y == pytest.approx(50)
        assert e.shot.xg == .5
        assert e.goal is not None
    assert normalized_location(None) is None
    with pytest.raises(ValueError):
        normalized_location([130, 50])


def test_upsert_requires_identity(factory):
    with factory() as db, pytest.raises(ValueError):
        upsert(db, Team, {}, {"name": "unsafe"})
