from datetime import date, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.db.models import (
    CollectionState, Competition, DataSource, Event, EventPosition, EventType,
    Lineup, Match, Player, PlayerMatchStatistics, Season, Shot, Team,
    TeamMatchStatistics,
)
from app.services.event_sources import preferred_shot_event_ids
from app.services.pitchapi_sync import (
    PitchAPIClient, PitchAPIError, _upsert_source_match, sync_pitchapi,
)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        yield db
    engine.dispose()


@pytest.fixture
def seeded(db_session):
    competition = Competition(
        name="Premier League", code="PL", data_source=DataSource.UNDERSTAT,
    )
    db_session.add(competition)
    db_session.flush()
    season = Season(
        competition_id=competition.id, name="2026",
        start_date=date(2026, 8, 1), end_date=date(2027, 6, 30),
        data_source=DataSource.UNDERSTAT,
    )
    home = Team(name="Arsenal", data_source=DataSource.UNDERSTAT)
    away = Team(name="Brighton & Hove Albion", data_source=DataSource.UNDERSTAT)
    db_session.add_all([season, home, away])
    db_session.flush()
    match = Match(
        external_id="understat-match-1",
        season_id=season.id,
        home_team_id=home.id,
        away_team_id=away.id,
        kickoff_time=datetime(2026, 9, 12, 14),
        status="finished",
        home_score=1,
        away_score=0,
        data_source=DataSource.UNDERSTAT,
    )
    saka = Player(
        display_name="Bukayo Saka", last_name="Saka", team_id=home.id,
        data_source=DataSource.UNDERSTAT,
    )
    welbeck = Player(
        display_name="Danny Welbeck", last_name="Welbeck", team_id=away.id,
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add_all([match, saka, welbeck])
    db_session.flush()
    return {
        "competition": competition,
        "season": season,
        "match": match,
        "home": home,
        "away": away,
        "saka": saka,
        "welbeck": welbeck,
    }


def _fixture():
    return {
        "id": "api-match-1",
        "league": {"id": "league-55"},
        "time_utc": "2026-09-12T14:00:00Z",
        "status": "finished",
        "home_team": {"id": "api-home", "name": "Arsenal"},
        "away_team": {"id": "api-away", "name": "Brighton"},
        "score_home": 1,
        "score_away": 0,
    }


class FixtureClient:
    def __init__(self):
        self.date_calls = []
        self.match_calls = []

    def fixtures_for_date(self, fixture_date):
        self.date_calls.append(fixture_date)
        return [_fixture()]

    def lineups(self, match_id):
        self.match_calls.append(("lineups", match_id))
        return {
            "home": {
                "confirmed": True,
                "formation": "4-3-3",
                "starters": [{
                    "name": "Bukayo Saka",
                    "shirt_number": 7,
                    "position_id": 87,
                    "pitch_x": 0.5,
                    "pitch_y": 0.89,
                }],
                "subs": [],
            },
            "away": {"confirmed": False, "starters": [], "subs": []},
        }

    def shots(self, match_id):
        self.match_calls.append(("shots", match_id))
        return {
            "periods": [{
                "name": "FirstHalf",
                "shots": [{
                    "id": "shot-1",
                    "team_id": "api-home",
                    "player": {"id": "api-player", "name": "Bukayo Saka"},
                    "minute": 44,
                    "event_type": "Goal",
                    "shot_type": "RightFoot",
                    "situation": "OpenPlay",
                    "x": 88.5,
                    "y": 42.3,
                    "expected_goals": 0.3,
                    "expected_goals_on_target": 0.6,
                    "is_on_target": True,
                }],
            }],
        }

    def players(self, match_id):
        self.match_calls.append(("players", match_id))
        return [{
            "player": {"name": "Bukayo Saka"},
            "team_id": "api-home",
            "stats": [{
                "key": "top_stats",
                "stats": {
                    "Goals": {
                        "key": "goals",
                        "stat": {"type": "integer", "value": 1},
                    },
                    "Total shots": {
                        "key": "total_shots",
                        "stat": {"type": "integer", "value": 1},
                    },
                    "Minutes played": {
                        "key": "minutes_played",
                        "stat": {"type": "integer", "value": 90},
                    },
                    "Expected goals (xG)": {
                        "key": "expected_goals",
                        "stat": {"type": "double", "value": 0.3},
                    },
                },
            }],
        }]

    def statistics(self, match_id):
        self.match_calls.append(("stats", match_id))
        return {
            "periods": [{
                "period": "All",
                "groups": [{
                    "group_name": "Expected goals (xG)",
                    "items": [{
                        "key": "expected_goals",
                        "home": "0.5",
                        "away": "0.2",
                        "format_type": "double",
                    }],
                }, {
                    "group_name": "Top stats",
                    "items": [
                        {
                            "key": "BallPossesion",
                            "home": "61",
                            "away": "39",
                            "format_type": "integer",
                        },
                        {
                            "key": "total_shots",
                            "home": "10",
                            "away": "4",
                            "format_type": "integer",
                        },
                        {
                            "key": "accurate_passes",
                            "home": "329 (82%)",
                            "away": "250 (78%)",
                            "format_type": "integerWithPercentage",
                        },
                    ],
                }],
            }],
        }


def test_pitchapi_import_is_source_aware_and_idempotent(seeded, db_session):
    client = FixtureClient()

    first = sync_pitchapi(
        db_session, client, date(2026, 9, 12), date(2026, 9, 12), ("PL",),
    )

    assert first["matches_matched"] == 1
    assert first["matches_synced"][0]["status"] == "success"
    assert first["matches_synced"][0]["shots"] == 1
    assert ("lineups", "api-match-1") in client.match_calls

    event = db_session.scalar(
        select(Event).where(Event.data_source == DataSource.PITCH_API)
    )
    assert event is not None
    assert event.match_id == seeded["match"].id
    assert event.external_id == "league-55:api-match-1:shot-1"
    assert event.position.x == pytest.approx(88.5 * 100 / 105)
    assert event.position.y == pytest.approx(42.3 * 100 / 68)
    assert event.shot.xg == 0.3 and event.shot.psxg == 0.6 and event.shot.is_goal

    mirror = db_session.scalar(
        select(Match).where(Match.data_source == DataSource.PITCH_API)
    )
    assert mirror is not None and mirror.canonical_match_id == seeded["match"].id

    lineup = db_session.scalar(
        select(Lineup).where(Lineup.match_id == seeded["match"].id)
    )
    assert lineup is not None
    assert lineup.player_id == seeded["saka"].id and lineup.is_starter
    assert lineup.shirt_number == 7

    player_stats = db_session.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.player_id == seeded["saka"].id,
        )
    )
    assert player_stats is not None
    assert player_stats.goals == 1 and player_stats.shots == 1
    assert player_stats.minutes_played == 90
    assert "pitchapi" in player_stats.supplemental_stats

    team_stats = db_session.scalar(
        select(TeamMatchStatistics).where(
            TeamMatchStatistics.team_id == seeded["home"].id,
        )
    )
    assert team_stats is not None
    assert team_stats.shots == 10 and team_stats.goals == 1
    assert team_stats.xg == pytest.approx(0.5)
    assert team_stats.passes_completed == 329
    assert team_stats.possession_pct == 61

    state = db_session.scalar(
        select(CollectionState).where(CollectionState.provider == "pitchapi")
    )
    assert state is not None and state.status == "success"

    calls_before = len(client.match_calls)
    second = sync_pitchapi(
        db_session, client, date(2026, 9, 12), date(2026, 9, 12), ("PL",),
    )
    assert second["matches_skipped"] == 1
    assert len(client.match_calls) == calls_before


def test_ambiguous_fixture_does_not_create_pitchapi_match(seeded, db_session):
    duplicate = Match(
        external_id="another-source-match",
        season_id=seeded["season"].id,
        home_team_id=seeded["home"].id,
        away_team_id=seeded["away"].id,
        kickoff_time=seeded["match"].kickoff_time,
        status="finished",
        data_source=DataSource.FOOTBALL_DATA,
    )
    db_session.add(duplicate)
    db_session.flush()

    result = sync_pitchapi(
        db_session, FixtureClient(), date(2026, 9, 12), date(2026, 9, 12), ("PL",),
    )

    assert result["matches_ambiguous"] == 1
    assert db_session.scalar(
        select(Match).where(Match.data_source == DataSource.PITCH_API)
    ) is None


def test_pitchapi_completes_only_missing_finished_results(seeded, db_session):
    match = seeded["match"]
    match.kickoff_time = datetime(2020, 9, 12, 14)
    match.status, match.home_score, match.away_score = "scheduled", None, None
    _upsert_source_match(db_session, _fixture(), "league:match", match)
    assert (match.status, match.home_score, match.away_score) == ("finished", 1, 0)

    match.status, match.home_score, match.away_score = "scheduled", 2, 1
    _upsert_source_match(db_session, _fixture(), "league:match", match)
    assert (match.status, match.home_score, match.away_score) == ("scheduled", 2, 1)

    match.status, match.home_score, match.away_score = "scheduled", None, None
    fixture = {**_fixture(), "status": "scheduled"}
    _upsert_source_match(db_session, fixture, "league:match", match)
    assert (match.status, match.home_score, match.away_score) == ("scheduled", None, None)


def test_shot_analytics_prefers_understat_then_falls_back_to_pitchapi(seeded, db_session):
    understat_event = Event(
        external_id="understat-shot",
        match_id=seeded["match"].id,
        team_id=seeded["home"].id,
        type=EventType.SHOT,
        minute=10,
        data_source=DataSource.UNDERSTAT,
    )
    pitchapi_event = Event(
        external_id="pitchapi-shot",
        match_id=seeded["match"].id,
        team_id=seeded["home"].id,
        type=EventType.SHOT,
        minute=11,
        data_source=DataSource.PITCH_API,
    )
    understat_event.position = EventPosition(x=90, y=50)
    understat_event.shot = Shot(xg=0.2)
    pitchapi_event.position = EventPosition(x=95, y=50)
    pitchapi_event.shot = Shot(xg=0.3)
    db_session.add_all([understat_event, pitchapi_event])
    db_session.flush()

    selected = list(db_session.scalars(
        select(Event).where(Event.id.in_(preferred_shot_event_ids()))
    ).all())
    assert [event.id for event in selected] == [understat_event.id]

    understat_event.type = EventType.PASS
    db_session.flush()
    selected = list(db_session.scalars(
        select(Event).where(Event.id.in_(preferred_shot_event_ids()))
    ).all())
    assert [event.id for event in selected] == [pitchapi_event.id]


def test_pitchapi_client_uses_key_header_and_unwraps_data():
    class Response:
        status_code = 200
        headers = {}

        @staticmethod
        def json():
            return {"data": [{"id": "match-1"}]}

    class Session:
        def __init__(self):
            self.headers = {}
            self.request = None

        def get(self, url, params=None, timeout=None):
            self.request = (url, params, timeout)
            return Response()

        @staticmethod
        def close():
            pass

    session = Session()
    client = PitchAPIClient("rotated-test-key", session=session)

    assert client.fixtures_for_date(date(2026, 9, 12)) == [{"id": "match-1"}]
    assert session.headers["X-API-KEY"] == "rotated-test-key"
    assert session.request[0].endswith("/date/2026-09-12")
    assert session.request[1] == {"status": "all"}


def test_pitchapi_client_retries_transient_server_errors(monkeypatch):
    class Response:
        headers = {}

        def __init__(self, status_code, payload):
            self.status_code = status_code
            self.payload = payload

        def json(self):
            return self.payload

    class Session:
        headers = {}

        def __init__(self):
            self.responses = [
                Response(502, {}),
                Response(200, {"data": [{"id": "match-1"}]}),
            ]

        def get(self, *args, **kwargs):
            return self.responses.pop(0)

    monkeypatch.setattr("app.services.pitchapi_sync.time.sleep", lambda _: None)
    session = Session()
    client = PitchAPIClient("rotated-test-key", session=session)

    assert client.fixtures_for_date(date(2026, 9, 12)) == [{"id": "match-1"}]
    assert session.responses == []


def test_pitchapi_client_surfaces_rate_limit_without_revealing_key():
    class Response:
        status_code = 429
        headers = {"Retry-After": "30"}

    class Session:
        headers = {}

        @staticmethod
        def get(*args, **kwargs):
            return Response()

    client = PitchAPIClient("secret-test-key", session=Session())

    with pytest.raises(PitchAPIError, match="30s") as error:
        client.fixtures_for_date(date(2026, 9, 12))

    assert "secret-test-key" not in str(error.value)
