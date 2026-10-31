from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.db.models import Competition, DataSource, Match, Season, Team
from app.main import app as fastapi_app
from app.services.match_reconciliation import reconcile_matches


def test_reconcile_links_cross_source_fixtures_without_deleting_source_rows():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    try:
        with factory() as db:
            football_comp = Competition(
                external_id="pl-fd", name="Premier League", code="PL",
                country="England", data_source=DataSource.FOOTBALL_DATA,
            )
            understat_comp = Competition(
                external_id="pl-us", name="Premier League", code="PL",
                country="England", data_source=DataSource.UNDERSTAT,
            )
            other_comp = Competition(
                external_id="fa-us", name="FA Cup", code="FAC",
                country="England", data_source=DataSource.UNDERSTAT,
            )
            db.add_all([football_comp, understat_comp, other_comp])
            db.flush()
            football_season = Season(
                competition_id=football_comp.id, name="2026",
                data_source=DataSource.FOOTBALL_DATA,
            )
            understat_season = Season(
                competition_id=understat_comp.id, name="2026",
                data_source=DataSource.UNDERSTAT,
            )
            other_season = Season(
                competition_id=other_comp.id, name="2026",
                data_source=DataSource.UNDERSTAT,
            )
            db.add_all([football_season, understat_season, other_season])
            db.flush()

            football_home = Team(
                external_id="fd-home", name="Chelsea FC",
                data_source=DataSource.FOOTBALL_DATA,
            )
            football_away = Team(
                external_id="fd-away", name="Manchester United FC",
                data_source=DataSource.FOOTBALL_DATA,
            )
            understat_home = Team(
                external_id="us-home", name="Chelsea",
                data_source=DataSource.UNDERSTAT,
            )
            understat_away = Team(
                external_id="us-away", name="Manchester United",
                data_source=DataSource.UNDERSTAT,
            )
            db.add_all([football_home, football_away, understat_home, understat_away])
            db.flush()

            kickoff = datetime.utcnow() + timedelta(days=5)
            football_match = Match(
                external_id="fd-match", season_id=football_season.id,
                home_team_id=football_home.id, away_team_id=football_away.id,
                kickoff_time=kickoff, data_source=DataSource.FOOTBALL_DATA,
            )
            understat_match = Match(
                external_id="us-match", season_id=understat_season.id,
                home_team_id=understat_home.id, away_team_id=understat_away.id,
                kickoff_time=kickoff + timedelta(minutes=30),
                data_source=DataSource.UNDERSTAT,
            )
            different_competition = Match(
                external_id="cup-match", season_id=other_season.id,
                home_team_id=understat_home.id, away_team_id=understat_away.id,
                kickoff_time=kickoff, data_source=DataSource.UNDERSTAT,
            )
            db.add_all([football_match, understat_match, different_competition])
            db.flush()

            result = reconcile_matches(db)
            db.commit()

            assert result == {"candidate_pairs": 1, "linked_pairs": 1, "linked_rows": 1}
            assert understat_match.canonical_match_id is None
            assert football_match.canonical_match_id == understat_match.id
            assert different_competition.canonical_match_id is None
            assert db.scalar(select(func.count()).select_from(Match)) == 3
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_matches_endpoint_lists_only_canonical_fixtures():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    with factory() as db:
        competition = Competition(
            external_id="pl", name="Premier League", code="PL",
            country="England", data_source=DataSource.UNDERSTAT,
        )
        db.add(competition)
        db.flush()
        season = Season(
            competition_id=competition.id, name="2026",
            data_source=DataSource.UNDERSTAT,
        )
        home = Team(external_id="1", name="Home", data_source=DataSource.UNDERSTAT)
        away = Team(external_id="2", name="Away", data_source=DataSource.UNDERSTAT)
        db.add_all([season, home, away])
        db.flush()
        canonical = Match(
            external_id="canonical", season_id=season.id,
            home_team_id=home.id, away_team_id=away.id,
            kickoff_time=datetime.utcnow() + timedelta(days=1),
            data_source=DataSource.UNDERSTAT,
        )
        alias = Match(
            external_id="alias", season_id=season.id,
            home_team_id=home.id, away_team_id=away.id,
            kickoff_time=datetime.utcnow() + timedelta(days=1),
            data_source=DataSource.FOOTBALL_DATA,
        )
        db.add_all([canonical, alias])
        db.flush()
        alias.canonical_match_id = canonical.id
        db.commit()

    def override_db():
        with factory() as db:
            yield db

    fastapi_app.dependency_overrides[get_db] = override_db
    try:
        response = TestClient(fastapi_app).get("/api/matches", params={"scope": "upcoming"})
        assert response.status_code == 200
        assert [row["id"] for row in response.json()] == [canonical.id]
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(engine)
        engine.dispose()
