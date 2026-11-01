from datetime import datetime

import pandas as pd
import pytest
from lxml import html
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.db.models import (
    Competition, DataSource, Lineup, Match, Player, PlayerMatchStatistics,
    PlayerStatistics, Season, Team,
)
from app.services.aggregates import compute_match_aggregates, compute_player_season_aggregates
from app.services.soccerdata_sync import (
    _attach_game_ids, _finished_game_ids, _match_schedule, _records, _schedule_from_html_table,
    _source_date, sync_soccerdata_rows,
)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        yield db
    engine.dispose()


@pytest.fixture
def seeded(db_session):
    comp = Competition(
        external_id="epl",
        name="Premier League",
        code="PL",
        country="England",
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add(comp)
    db_session.flush()
    season = Season(
        competition_id=comp.id,
        name="2026",
        start_date=datetime(2026, 8, 1).date(),
        end_date=datetime(2027, 6, 30).date(),
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add(season)
    db_session.flush()

    home = Team(external_id="arsenal-us", name="Arsenal", data_source=DataSource.UNDERSTAT)
    away = Team(external_id="brighton-us", name="Brighton & Hove Albion", data_source=DataSource.UNDERSTAT)
    db_session.add_all([home, away])
    db_session.flush()
    match = Match(
        external_id="us-1",
        season_id=season.id,
        home_team_id=home.id,
        away_team_id=away.id,
        kickoff_time=datetime(2026, 9, 12, 14),
        status="finished",
        home_score=1,
        away_score=0,
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add(match)

    arsenal_player = Player(
        external_id="saka-us",
        last_name="Bukayo Saka",
        display_name="Bukayo Saka",
        team_id=home.id,
        data_source=DataSource.UNDERSTAT,
    )
    brighton_player = Player(
        external_id="welbeck-us",
        last_name="Danny Welbeck",
        display_name="Danny Welbeck",
        team_id=away.id,
        data_source=DataSource.UNDERSTAT,
    )
    db_session.add_all([arsenal_player, brighton_player])
    db_session.flush()
    existing_season_stats = PlayerStatistics(
        player_id=arsenal_player.id,
        season_id=season.id,
        scope="overall",
        assists=3,
        xg_total=0.8,
    )
    db_session.add(existing_season_stats)
    db_session.commit()
    return {
        "match": match,
        "home": home,
        "away": away,
        "home_player": arsenal_player,
        "away_player": brighton_player,
        "season_stats": existing_season_stats,
    }


def _import(db_session, seeded):
    schedule = [{
        "game_id": "fbref-game-1",
        "date": "2026-09-12",
        "home_team": "Arsenal",
        "away_team": "Brighton & Hove Albion",
        "score": "1–0",
    }]
    lineups = [
        {
            "game_id": "fbref-game-1", "team": "Arsenal", "player": "Bukayo Saka",
            "jersey_number": 7, "position": "RW", "is_starter": True, "minutes_played": 90,
        },
        {
            "game_id": "fbref-game-1", "team": "Brighton & Hove Albion", "player": "Danny Welbeck",
            "jersey_number": 18, "position": "FW", "is_starter": True, "minutes_played": 90,
        },
    ]
    player_match_stats = [
        {
            "game_id": "fbref-game-1", "team": "Arsenal", "player": "Bukayo Saka",
            ("Performance", "Gls"): 0, ("Performance", "Ast"): 1,
            ("Performance", "TklW"): 2, ("Performance", "Int"): 1,
            ("Performance", "Fls"): 0, ("Performance", "Fld"): 2,
            ("Playing Time", "Min"): 90,
        },
        {
            "game_id": "fbref-game-1", "team": "Brighton & Hove Albion", "player": "Danny Welbeck",
            ("Performance", "Gls"): 0, ("Performance", "Ast"): 0,
            ("Performance", "TklW"): 1, ("Performance", "Int"): 0,
            ("Performance", "Fls"): 2, ("Performance", "Fld"): 1,
            ("Playing Time", "Min"): 90,
        },
    ]
    standard = [{
        "team": "Arsenal", "player": "Bukayo Saka",
        ("Playing Time", "MP"): 2, ("Playing Time", "Starts"): 2,
        ("Playing Time", "Min"): 180, ("Performance", "Ast"): 5,
        ("Per 90 Minutes", "Ast"): 0.25,
    }]
    misc = [{
        "team": "Arsenal", "player": "Bukayo Saka",
        ("Performance", "TklW"): 4, ("Performance", "Int"): 3,
        ("Performance", "Clr"): 2, ("Aerial Duels", "Won"): 5,
        ("Aerial Duels", "Lost"): 1,
    }]
    return sync_soccerdata_rows(
        db_session, "PL", schedule, lineups, player_match_stats, standard, misc,
    )


def test_records_include_fbref_multiindex_values():
    frame = pd.DataFrame(
        [{("Performance", "Ast"): 2}],
        index=pd.MultiIndex.from_tuples(
            [("ENG-Premier League", "2026-27", "2026-09-12 Arsenal-Brighton")],
            names=["league", "season", "game"],
        ),
    )
    assert _records(frame) == [{
        "league": "ENG-Premier League",
        "season": "2026-27",
        "game": "2026-09-12 Arsenal-Brighton",
        ("Performance", "Ast"): 2,
    }]


def test_records_flatten_multiindex_player_and_team_columns():
    frame = pd.DataFrame(
        [[5]],
        index=pd.MultiIndex.from_tuples(
            [("Arsenal", "Bukayo Saka")],
            names=["team", "player"],
        ),
        columns=pd.MultiIndex.from_tuples([("Performance", "Ast")]),
    )

    record = _records(frame)[0]

    assert record["team"] == "Arsenal"
    assert record["player"] == "Bukayo Saka"
    assert record[("Performance", "Ast")] == 5


def test_attach_game_ids_to_rows_indexed_by_game():
    rows = [{"game": "2026-10-31 Arsenal-Brighton", "player": "Bukayo Saka"}]
    schedule = [{
        "game": "2026-10-31 Arsenal-Brighton",
        "game_id": "fbref-game-1",
    }]

    assert _attach_game_ids(rows, schedule)[0]["game_id"] == "fbref-game-1"


def test_finished_game_ids_excludes_unplayed_fixtures():
    matches = {
        "played": Match(status="finished"),
        "upcoming": Match(status="scheduled"),
        "cancelled": Match(status="cancelled"),
    }

    assert _finished_game_ids(matches) == ["played"]


def test_fbref_schedule_without_date_column_retains_report_id():
    table = html.fromstring("""
        <table>
          <tbody>
            <tr>
              <th data-stat="round">Premier League</th>
              <td data-stat="gameweek">9</td>
              <td data-stat="home_team">Arsenal</td>
              <td data-stat="score">1–0</td>
              <td data-stat="away_team">Brighton &amp; Hove Albion</td>
              <td data-stat="match_report">
                <a href="/en/matches/fbref-game-1/Arsenal-Brighton-October-31-2026-Premier-League">Match Report</a>
              </td>
            </tr>
          </tbody>
        </table>
    """)

    record = _records(_schedule_from_html_table(table, "ENG-Premier League", "2627"))[0]

    assert record["game_id"] == "fbref-game-1"
    assert record["home_team"] == "Arsenal"
    assert record["away_team"] == "Brighton & Hove Albion"
    assert _source_date(record).isoformat() == "2026-10-31"


def test_sync_enriches_existing_rows_idempotently_without_duplicate_entities(db_session, seeded):
    result = _import(db_session, seeded)

    assert result["matches_matched"] == 1
    assert result["lineups_inserted"] == 2
    assert result["player_match_stats_inserted"] == 2
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1
    assert db_session.scalar(select(func.count()).select_from(Team)) == 2
    assert db_session.scalar(select(func.count()).select_from(Player)) == 2

    lineup = db_session.scalar(
        select(Lineup).where(Lineup.player_id == seeded["home_player"].id)
    )
    assert lineup is not None
    assert (lineup.shirt_number, lineup.position, lineup.minutes_played) == (7, "RW", 90)

    match_stats = db_session.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.player_id == seeded["home_player"].id,
        )
    )
    assert match_stats is not None
    assert (match_stats.assists, match_stats.tackles, match_stats.interceptions) == (1, 2, 1)
    assert match_stats.supplemental_stats["soccerdata"]["fouls_suffered"] == 2

    season_stats = seeded["season_stats"]
    assert season_stats.assists == 3
    assert season_stats.xg_total == 0.8
    assert (season_stats.tackles, season_stats.interceptions, season_stats.clearances) == (4, 3, 2)
    assert (season_stats.aerials_won, season_stats.aerials_lost) == (5, 1)
    assert season_stats.supplemental_stats["soccerdata"]["assists"] == 5

    repeated = _import(db_session, seeded)
    assert repeated["lineups_inserted"] == 0
    assert repeated["player_match_stats_inserted"] == 0
    assert db_session.scalar(select(func.count()).select_from(Lineup)) == 2
    assert db_session.scalar(select(func.count()).select_from(PlayerMatchStatistics)) == 2


def test_sync_skips_unmatched_fixtures_instead_of_creating_matches(db_session, seeded):
    result = sync_soccerdata_rows(
        db_session,
        "PL",
        [{
            "game_id": "unknown",
            "date": "2026-09-12",
            "home_team": "Unknown FC",
            "away_team": "Unknown United",
            "score": "1–0",
        }],
        [],
        [],
        [],
        [],
    )
    assert result["matches_unmatched"] == 1
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1
    assert db_session.scalar(select(func.count()).select_from(Lineup)) == 0


def test_sync_matches_date_less_schedule_by_season_and_score(db_session, seeded):
    schedule = [{
        "game_id": "fbref-game-1",
        "season": "2627",
        "home_team": "Arsenal",
        "away_team": "Brighton & Hove Albion",
        "score": "1–0",
    }]
    result = sync_soccerdata_rows(db_session, "PL", schedule, [], [], [], [])

    assert result["matches_matched"] == 1
    assert db_session.scalar(select(func.count()).select_from(Match)) == 1

    schedule[0]["score"] = "2-0"
    result = sync_soccerdata_rows(db_session, "PL", schedule, [], [], [], [])
    assert result["matches_unmatched"] == 1


def test_sync_prefers_understat_match_when_sources_have_duplicate_fixture(db_session, seeded):
    season = db_session.get(Season, seeded["match"].season_id)
    duplicate_season = Season(
        competition_id=season.competition_id,
        name="2627",
        start_date=datetime(2026, 8, 1).date(),
        end_date=datetime(2027, 6, 30).date(),
        data_source=DataSource.FOOTBALL_DATA,
    )
    db_session.add(duplicate_season)
    db_session.flush()
    duplicate_home = Team(
        external_id="arsenal-football-data",
        name="Arsenal FC",
        data_source=DataSource.FOOTBALL_DATA,
    )
    duplicate_away = Team(
        external_id="brighton-football-data",
        name="Brighton",
        data_source=DataSource.FOOTBALL_DATA,
    )
    db_session.add_all([duplicate_home, duplicate_away])
    db_session.flush()
    duplicate_match = Match(
        external_id="football-data-1",
        season_id=duplicate_season.id,
        home_team_id=duplicate_home.id,
        away_team_id=duplicate_away.id,
        kickoff_time=seeded["match"].kickoff_time,
        status="finished",
        home_score=1,
        away_score=0,
        data_source=DataSource.FOOTBALL_DATA,
    )
    db_session.add(duplicate_match)
    db_session.flush()

    matches, team_context, summary = _match_schedule(
        db_session,
        "PL",
        [{
            "game_id": "fbref-game-1",
            "date": "2026-09-12",
            "season": "2627",
            "home_team": "Arsenal",
            "away_team": "Brighton & Hove Albion",
            "score": "1-0",
        }],
    )

    assert summary["matches_matched"] == 1
    assert summary["matches_ambiguous"] == 0
    assert matches["fbref-game-1"].id == seeded["match"].id
    assert team_context["arsenal"] == {
        (seeded["home"].id, seeded["match"].season_id),
    }


def test_event_reaggregation_preserves_soccerdata_values(db_session, seeded):
    _import(db_session, seeded)

    compute_match_aggregates(db_session, seeded["match"])
    compute_player_season_aggregates(
        db_session, seeded["home_player"].id, seeded["match"].season_id,
    )
    db_session.flush()

    match_stats = db_session.scalar(
        select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.player_id == seeded["home_player"].id,
        )
    )
    season_stats = db_session.scalar(
        select(PlayerStatistics).where(
            PlayerStatistics.player_id == seeded["home_player"].id,
            PlayerStatistics.season_id == seeded["match"].season_id,
        )
    )
    assert (match_stats.assists, match_stats.tackles, match_stats.interceptions) == (1, 2, 1)
    assert season_stats.assists == 3
    assert (season_stats.tackles, season_stats.clearances) == (4, 2)
    assert (season_stats.aerials_won, season_stats.aerials_lost) == (5, 1)
    assert season_stats.supplemental_stats["soccerdata"]["assists"] == 5


def test_extra_tables_feed_defender_and_goalkeeper_stats(db_session, seeded):
    keeper = Player(
        external_id="raya-us", last_name="David Raya", display_name="David Raya",
        team_id=seeded["home"].id, position="GK", data_source=DataSource.UNDERSTAT,
    )
    db_session.add(keeper)
    db_session.commit()

    schedule = [{
        "game_id": "fbref-game-1", "date": "2026-09-12",
        "home_team": "Arsenal", "away_team": "Brighton & Hove Albion", "score": "1–0",
    }]
    standard = [
        {"team": "Arsenal", "player": "David Raya", ("Playing Time", "MP"): 2,
         ("Playing Time", "Min"): 180, ("Playing Time", "Starts"): 2},
        {"team": "Arsenal", "player": "Bukayo Saka", ("Playing Time", "MP"): 2,
         ("Playing Time", "Min"): 180, ("Playing Time", "Starts"): 2},
    ]
    extra = {
        "keeper": [{
            "team": "Arsenal", "player": "David Raya",
            ("Performance", "GA"): 1, ("Performance", "SoTA"): 6, ("Performance", "Saves"): 5,
            ("Performance", "CS"): 1,
        }],
        "keeper_adv": [{
            "team": "Arsenal", "player": "David Raya",
            ("Expected", "PSxG"): 1.4, ("Crosses", "Opp"): 8, ("Crosses", "Stp"): 1,
            ("Launched", "Cmp"): 10, ("Launched", "Att"): 20,
        }],
        "defense": [{
            "team": "Arsenal", "player": "Bukayo Saka",
            ("Tackles", "Tkl"): 6, ("Tackles", "TklW"): 4, ("Blocks", "Blocks"): 3,
            "Int": 2, "Clr": 7, "Tkl+Int": 8,
        }],
        "passing": [{
            "team": "Arsenal", "player": "Bukayo Saka",
            ("Total", "Cmp"): 80, ("Total", "Att"): 100, "KP": 5, "PrgP": 9,
        }],
    }
    keeper_match = [{
        "game_id": "fbref-game-1", "team": "Arsenal", "player": "David Raya",
        ("Performance", "Saves"): 3, ("Performance", "GA"): 0, ("Performance", "SoTA"): 3,
        ("Playing Time", "Min"): 90,
    }]

    result = sync_soccerdata_rows(
        db_session, "PL", schedule, [], [], standard, [], extra, keeper_match,
    )

    assert result["keeper_match_stats_inserted"] == 1
    gk_match = db_session.scalar(select(PlayerMatchStatistics).where(
        PlayerMatchStatistics.player_id == keeper.id))
    assert (gk_match.saves, gk_match.goals_conceded, gk_match.shots_faced) == (3, 0, 3)

    gk_stats = db_session.scalar(select(PlayerStatistics).where(
        PlayerStatistics.player_id == keeper.id))
    provider = gk_stats.supplemental_stats["soccerdata"]
    assert (provider["gk_saves"], provider["gk_sota"], provider["gk_ga"]) == (5, 6, 1)
    assert provider["gk_psxg"] == 1.4 and provider["gk_crosses_opp"] == 8

    saka = db_session.scalar(select(PlayerStatistics).where(
        PlayerStatistics.player_id == seeded["home_player"].id,
        PlayerStatistics.season_id == seeded["match"].season_id,
    ))
    assert saka.clearances == 7            # só a tabela "defense" traz Cortes
    assert saka.interceptions == 2 and saka.key_passes == 5
    assert (saka.passes, saka.passes_completed) == (100, 80)
    assert saka.supplemental_stats["soccerdata"]["progressive_passes"] == 9
