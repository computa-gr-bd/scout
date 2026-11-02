from datetime import datetime

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.db.models import (
    Competition, DataSource, Lineup, Match, Player, PlayerMatchStatistics,
    Season, Team, TeamMatchStatistics,
)
from app.services.aggregates import compute_match_aggregates
from app.services.espn_sync import (
    _align_schedule_team_names, _event_schedule_row, _same_espn_team_name,
    _match_reversed_schedule_rows, _same_fixture, _season_match_targets,
    sync_espn_rows,
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
        external_id="epl", name="Premier League", code="PL",
        country="England", data_source=DataSource.UNDERSTAT,
    )
    db_session.add(competition)
    db_session.flush()
    season = Season(
        competition_id=competition.id, name="2026",
        start_date=datetime(2026, 8, 1).date(),
        end_date=datetime(2027, 6, 30).date(),
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add(season)
    db_session.flush()
    home = Team(
        external_id="arsenal-us", name="Arsenal",
        data_source=DataSource.UNDERSTAT,
    )
    away = Team(
        external_id="brighton-us", name="Brighton & Hove Albion",
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add_all([home, away])
    db_session.flush()
    match = Match(
        external_id="us-1", season_id=season.id,
        home_team_id=home.id, away_team_id=away.id,
        kickoff_time=datetime(2026, 9, 12, 14), status="finished",
        home_score=1, away_score=0, data_source=DataSource.UNDERSTAT,
    )
    saka = Player(
        external_id="saka-us", last_name="Bukayo Saka",
        display_name="Bukayo Saka", team_id=home.id,
        data_source=DataSource.UNDERSTAT,
    )
    welbeck = Player(
        external_id="welbeck-us", last_name="Danny Welbeck",
        display_name="Danny Welbeck", team_id=away.id,
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add_all([match, saka, welbeck])
    db_session.flush()
    return {"match": match, "home": home, "away": away, "saka": saka, "welbeck": welbeck}


def _schedule():
    return [{
        "game_id": "espn-1",
        "date": "2026-09-12T14:00:00Z",
        "season": "2026-27",
        "home_team": "Arsenal",
        "away_team": "Brighton",
        "score": "1-0",
        "completed": True,
    }]


def _summary():
    return {
        "rosters": [
            {
                "homeAway": "home",
                "roster": [{
                    "athlete": {"displayName": "Bukayo Saka"},
                    "jersey": "7", "starter": True,
                    "position": {"abbreviation": "RW"},
                    "stats": [
                        {"name": "totalShots", "value": 3},
                        {"name": "shotsOnTarget", "value": 1},
                        {"name": "goalAssists", "value": 1},
                    ],
                }],
            },
            {
                "homeAway": "away",
                "roster": [{
                    "athlete": {"displayName": "Danny Welbeck"},
                    "jersey": "18", "starter": True,
                    "position": {"abbreviation": "FW"},
                    "stats": [
                        {"name": "totalShots", "value": 2},
                        {"name": "shotsOnTarget", "value": 1},
                    ],
                }],
            },
        ],
        "boxscore": {
            "teams": [
                {
                    "homeAway": "home",
                    "statistics": [
                        {"name": "totalTackles", "displayValue": "14"},
                        {"name": "interceptions", "displayValue": "9"},
                        {"name": "totalClearance", "displayValue": "21"},
                        {"name": "blockedShots", "displayValue": "2"},
                        {"name": "possessionPct", "displayValue": "61.4"},
                    ],
                },
                {
                    "homeAway": "away",
                    "statistics": [
                        {"name": "totalTackles", "displayValue": "11"},
                        {"name": "interceptions", "displayValue": "7"},
                        {"name": "totalClearance", "displayValue": "25"},
                        {"name": "blockedShots", "displayValue": "4"},
                        {"name": "possessionPct", "displayValue": "38.6"},
                    ],
                },
            ],
        },
    }


def test_event_schedule_row_uses_home_away_and_completed_status():
    event = {
        "id": "123",
        "date": "2026-09-12T14:00:00Z",
        "status": {"type": {"completed": True}},
        "competitions": [{
            "competitors": [
                {
                    "homeAway": "away", "score": "0",
                    "team": {"displayName": "Brighton"},
                },
                {
                    "homeAway": "home", "score": "1",
                    "team": {"displayName": "Arsenal"},
                },
            ],
        }],
    }

    assert _event_schedule_row(event, "2026-27") == {
        "game_id": "123",
        "date": "2026-09-12T14:00:00Z",
        "season": "2026-27",
        "home_team": "Arsenal",
        "away_team": "Brighton",
        "score": "1-0",
        "completed": True,
    }


def test_team_aliases_and_duplicate_source_fixtures_use_canonical_match(db_session, seeded):
    duplicate_competition = Competition(
        external_id="football-data-epl", name="Premier League",
        code="PL", country="England",
        data_source=DataSource.FOOTBALL_DATA,
    )
    db_session.add(duplicate_competition)
    db_session.flush()
    duplicate_season = Season(
        competition_id=duplicate_competition.id, name="2026-27",
        start_date=datetime(2026, 8, 1).date(),
        end_date=datetime(2027, 6, 30).date(),
        data_source=DataSource.FOOTBALL_DATA,
    )
    duplicate_home = Team(
        external_id="arsenal-football-data", name="Arsenal FC",
        data_source=DataSource.FOOTBALL_DATA,
    )
    duplicate_away = Team(
        external_id="brighton-football-data", name="Brighton",
        data_source=DataSource.FOOTBALL_DATA,
    )
    db_session.add_all([duplicate_season, duplicate_home, duplicate_away])
    db_session.flush()
    db_session.add(Match(
        external_id="football-data-1", season_id=duplicate_season.id,
        home_team_id=duplicate_home.id, away_team_id=duplicate_away.id,
        kickoff_time=datetime(2026, 9, 12, 14), status="finished",
        home_score=1, away_score=0, data_source=DataSource.FOOTBALL_DATA,
    ))
    db_session.flush()
    schedule = [{
        "game_id": "espn-1",
        "date": "2026-09-12T14:00:00Z",
        "season": "2026-27",
        "home_team": "Arsenal FC",
        "away_team": "Brighton",
        "score": "1-0",
    }]

    assert _same_espn_team_name("RB Leipzig", "RasenBallsport Leipzig")
    assert _align_schedule_team_names(db_session, "PL", "2026-27", schedule) == 1
    assert schedule[0]["home_team"] == "Arsenal"
    assert schedule[0]["away_team"] == "Brighton & Hove Albion"
    targets = _season_match_targets(db_session, "PL", "2026-27")
    assert list(targets) == [seeded["match"].id]


def test_sync_is_idempotent_and_preserves_provider_stats(db_session, seeded):
    schedule = _schedule()
    summaries = {"espn-1": _summary()}

    first = sync_espn_rows(db_session, "PL", schedule, summaries)
    second = sync_espn_rows(
        db_session, "PL", schedule, summaries,
        {"espn-1": seeded["match"].id},
    )

    assert first["lineups_inserted"] == 2
    assert first["player_match_stats_inserted"] == 2
    assert first["team_match_stats_inserted"] == 2
    assert first["team_match_stats_updated"] == 0
    assert second["lineups_inserted"] == 0
    assert second["player_match_stats_inserted"] == 0
    assert second["team_match_stats_inserted"] == 0
    assert second["team_match_stats_updated"] == 2
    assert db_session.scalar(select(func.count(Lineup.id))) == 2
    assert db_session.scalar(select(func.count(PlayerMatchStatistics.id))) == 2
    assert db_session.scalar(select(func.count(TeamMatchStatistics.id))) == 2

    player_stats = db_session.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.player_id == seeded["saka"].id,
        )
    )
    team_stats = db_session.scalar(
        select(TeamMatchStatistics).where(
            TeamMatchStatistics.team_id == seeded["home"].id,
        )
    )
    assert player_stats.assists == 1
    assert player_stats.shots == 3
    assert team_stats.tackles == 14
    assert team_stats.clearances == 21
    assert team_stats.shots_blocked == 2
    assert team_stats.supplemental_stats["espn"]["raw"]["totalTackles"] == "14"


def test_reversed_fixture_maps_rosters_and_team_stats_to_the_correct_teams(
    db_session, seeded,
):
    schedule = _schedule()
    schedule[0].update(
        home_team="Brighton & Hove Albion",
        away_team="Arsenal",
        score="0-1",
    )
    reversed_matches = _match_reversed_schedule_rows(
        db_session, "PL", "2026-27", schedule,
    )
    assert reversed_matches == {"espn-1": seeded["match"]}

    summary = _summary()
    home_roster, away_roster = summary["rosters"]
    summary["rosters"] = [
        {
            **away_roster,
            "homeAway": "home",
            "team": {"displayName": "Brighton"},
        },
        {
            **home_roster,
            "homeAway": "away",
            "team": {"displayName": "Arsenal"},
        },
    ]
    home_boxscore, away_boxscore = summary["boxscore"]["teams"]
    summary["boxscore"]["teams"] = [
        {
            **away_boxscore,
            "homeAway": "home",
            "team": {"displayName": "Brighton"},
        },
        {
            **home_boxscore,
            "homeAway": "away",
            "team": {"displayName": "Arsenal"},
        },
    ]

    sync_espn_rows(
        db_session,
        "PL",
        schedule,
        {"espn-1": summary},
        {"espn-1": seeded["match"].id},
    )

    lineups = {
        row.player_id: row.team_id
        for row in db_session.scalars(select(Lineup)).all()
    }
    assert lineups == {
        seeded["saka"].id: seeded["home"].id,
        seeded["welbeck"].id: seeded["away"].id,
    }
    team_stats = {
        row.team_id: row
        for row in db_session.scalars(select(TeamMatchStatistics)).all()
    }
    assert {
        team_id: row.is_home for team_id, row in team_stats.items()
    } == {
        seeded["home"].id: False,
        seeded["away"].id: True,
    }
    assert team_stats[seeded["home"].id].tackles == 14
    assert team_stats[seeded["away"].id].tackles == 11


def test_duplicate_fixture_detection_handles_reversed_team_order(seeded):
    reversed_match = Match(
        season_id=seeded["match"].season_id,
        home_team_id=seeded["away"].id,
        away_team_id=seeded["home"].id,
        kickoff_time=seeded["match"].kickoff_time,
        status="finished",
        home_score=0,
        away_score=1,
        data_source=DataSource.FOOTBALL_DATA,
    )
    assert _same_fixture(
        seeded["match"], "Arsenal", "Brighton & Hove Albion",
        reversed_match, "Brighton", "Arsenal",
    )

    reversed_match.away_score = 0
    assert not _same_fixture(
        seeded["match"], "Arsenal", "Brighton & Hove Albion",
        reversed_match, "Brighton", "Arsenal",
    )


def test_match_aggregate_rebuild_keeps_espn_supplemental_values(db_session, seeded):
    sync_espn_rows(db_session, "PL", _schedule(), {"espn-1": _summary()})
    db_session.flush()

    compute_match_aggregates(db_session, seeded["match"])
    db_session.flush()
    compute_match_aggregates(db_session, seeded["match"])
    db_session.flush()

    player_stats = db_session.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.player_id == seeded["saka"].id,
        )
    )
    team_stats = db_session.scalar(
        select(TeamMatchStatistics).where(
            TeamMatchStatistics.team_id == seeded["home"].id,
        )
    )
    assert player_stats.assists == 1
    assert player_stats.shots == 3
    assert team_stats.tackles == 14
    assert team_stats.clearances == 21
    assert team_stats.shots_blocked == 2
