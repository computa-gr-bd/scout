from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.db.models import Competition, DataSource, Event, EventPosition, EventType, Match, Season, Shot, Standing, Team
from app.main import app
from app.services import home_recent_results as recent_service


@pytest.fixture
def home_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        yield db, TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        db.close()
        engine.dispose()


def _season(db, source, code="PL", country="England"):
    comp = Competition(name=code, code=code, country=country, data_source=source)
    db.add(comp)
    db.flush()
    season = Season(competition_id=comp.id, name="2025", data_source=source)
    db.add(season)
    db.flush()
    return season


def _match(db, season, source, kickoff, *, names=("Chelsea", "Arsenal"),
           countries=(None, None), status="finished", scores=(2, 1), root=None):
    home = Team(name=names[0], country=countries[0], data_source=source)
    away = Team(name=names[1], country=countries[1], data_source=source)
    db.add_all([home, away])
    db.flush()
    match = Match(
        season_id=season.id, home_team_id=home.id, away_team_id=away.id,
        kickoff_time=kickoff, status=status, home_score=scores[0], away_score=scores[1],
        data_source=source, canonical_match_id=root,
    )
    db.add(match)
    db.flush()
    return match


def _results(client, **params):
    response = client.get("/api/matches", params={"scope": "recent", "home_recent": True, **params})
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("params", [{"skip": -1}, {"limit": -1}])
def test_home_recent_rejects_negative_pagination(home_db, params):
    _, client = home_db
    response = client.get("/api/matches", params={"scope": "recent", "home_recent": True, **params})
    assert response.status_code == 400


def test_home_recent_uses_confirmed_sources_and_canonical_links_without_shots(home_db):
    db, client = home_db
    now = datetime.utcnow()
    us = _season(db, DataSource.UNDERSTAT)
    pitch = _season(db, DataSource.PITCH_API)
    fd = _season(db, DataSource.FOOTBALL_DATA)
    root = _match(db, fd, DataSource.FOOTBALL_DATA, now - timedelta(days=1))
    pitch_alias = _match(db, pitch, DataSource.PITCH_API, now - timedelta(days=1), root=root.id)
    us_alias = _match(db, us, DataSource.UNDERSTAT, now - timedelta(days=1), root=root.id)
    standalone = _match(db, pitch, DataSource.PITCH_API, now - timedelta(hours=5),
                        names=("Other", "Team"), status="FINISHED", scores=(0, 0))
    _match(db, pitch, DataSource.PITCH_API, now + timedelta(days=1), names=("Future", "Team"))
    _match(db, pitch, DataSource.PITCH_API, now - timedelta(hours=1),
           names=("Missing", "Score"), scores=(None, 1))
    _match(db, us, DataSource.UNDERSTAT, now - timedelta(hours=2),
           names=("Live", "Team"), status="live")
    _match(db, pitch, DataSource.PITCH_API, now - timedelta(hours=3),
           names=("Raw", "Status"), status="FT")
    db.commit()

    rows = _results(client)
    assert [row["id"] for row in rows] == [standalone.id, us_alias.id]
    assert rows[0]["home_score"] == rows[0]["away_score"] == 0
    assert rows[0]["status"] == "finished"
    assert pitch_alias.id not in [row["id"] for row in rows]
    assert rows[1]["home_team"]["logo_url"] is None
    assert [row["id"] for row in _results(client, skip=1, limit=1)] == [us_alias.id]


def test_fallback_requires_unambiguous_league_team_country_and_orientation(home_db):
    db, client = home_db
    now = datetime.utcnow() - timedelta(days=1)
    us = _season(db, DataSource.UNDERSTAT)
    pitch = _season(db, DataSource.PITCH_API)
    other_league = _season(db, DataSource.UNDERSTAT, "FAC")
    other_country = _season(db, DataSource.UNDERSTAT, "PL", "Scotland")
    preferred = _match(db, us, DataSource.UNDERSTAT, now)
    duplicate = _match(db, pitch, DataSource.PITCH_API, now + timedelta(minutes=30))
    cup = _match(db, other_league, DataSource.UNDERSTAT, now)
    scotland = _match(db, other_country, DataSource.UNDERSTAT, now)
    reversed_fixture = _match(db, pitch, DataSource.PITCH_API, now, names=("Arsenal", "Chelsea"))
    country_conflict = _match(db, pitch, DataSource.PITCH_API, now,
                              names=("United", "City"), countries=("Ecuador", "England"))
    country_us = _match(db, us, DataSource.UNDERSTAT, now,
                        names=("United", "City"), countries=("Spain", "England"))
    db.commit()

    ids = {row["id"] for row in _results(client)}
    assert ids == {preferred.id, cup.id, scotland.id, reversed_fixture.id,
                   country_conflict.id, country_us.id}
    assert duplicate.id not in ids


def test_ambiguous_fallback_does_not_merge_and_analysis_is_unchanged(home_db):
    db, client = home_db
    now = datetime.utcnow() - timedelta(days=1)
    us = _season(db, DataSource.UNDERSTAT)
    pitch = _season(db, DataSource.PITCH_API)
    first = _match(db, us, DataSource.UNDERSTAT, now)
    second = _match(db, us, DataSource.UNDERSTAT, now + timedelta(hours=1))
    third = _match(db, pitch, DataSource.PITCH_API, now)
    db.commit()

    assert {row["id"] for row in _results(client)} == {first.id, second.id, third.id}
    response = client.get("/api/matches", params={"scope": "recent", "analysis": True})
    assert response.status_code == 200
    assert response.json() == []


def test_home_alias_details_keep_selected_source_and_default_stays_canonical(home_db):
    db, client = home_db
    kickoff = datetime.utcnow() - timedelta(days=1)
    root = _match(db, _season(db, DataSource.FOOTBALL_DATA), DataSource.FOOTBALL_DATA,
                  kickoff, status="scheduled", scores=(None, None))
    alias = _match(db, _season(db, DataSource.PITCH_API), DataSource.PITCH_API,
                   kickoff, root=root.id, scores=(3, 1), status="FINISHED")
    db.commit()

    row = _results(client)[0]
    assert row["id"] == alias.id
    details = client.get(f"/api/matches/{row['id']}", params={"source_match": True}).json()
    assert (details["id"], details["status"], details["home_score"], details["away_score"]) == (
        alias.id, "finished", 3, 1,
    )
    assert client.get(f"/api/matches/{alias.id}").json()["id"] == root.id


def test_home_uses_official_crests_for_the_same_league_and_season(home_db):
    db, client = home_db
    kickoff = datetime.utcnow() - timedelta(days=1)
    understat = _season(db, DataSource.UNDERSTAT, "PD", "Spain")
    official = _season(db, DataSource.FOOTBALL_DATA, "PD", "Spain")
    wrong_country = _season(db, DataSource.FOOTBALL_DATA, "PD", "Bolivia")
    wrong_year = _season(db, DataSource.FOOTBALL_DATA, "PD", "Spain")
    understat.start_date = official.start_date = wrong_country.start_date = date(2026, 8, 1)
    wrong_year.start_date = date(2025, 8, 1)
    match = _match(db, understat, DataSource.UNDERSTAT, kickoff,
                   names=("Getafe", "Atletico Madrid"))
    match.away_team.logo_url = "https://example.invalid/own.png"
    for season, name, url in (
        (official, "Getafe CF", "https://example.invalid/getafe.png"),
        (official, "Club Atlético de Madrid", "https://example.invalid/atletico.png"),
        (wrong_country, "Getafe CF", "https://example.invalid/bolivia.png"),
        (wrong_year, "Getafe CF", "https://example.invalid/old.png"),
    ):
        team = Team(name=name, logo_url=url, data_source=DataSource.FOOTBALL_DATA)
        db.add(team)
        db.flush()
        db.add(Standing(season_id=season.id, team_id=team.id))
    db.commit()

    row = _results(client)[0]
    assert row["home_team"]["logo_url"] == "https://example.invalid/getafe.png"
    assert row["away_team"]["logo_url"] == "https://example.invalid/own.png"
    details = client.get(f"/api/matches/{match.id}", params={"source_match": True}).json()
    assert details["home_team"]["logo_url"] == row["home_team"]["logo_url"]


def test_home_does_not_guess_ambiguous_or_conflicting_crests(home_db):
    db, client = home_db
    source = _season(db, DataSource.UNDERSTAT)
    official = _season(db, DataSource.FOOTBALL_DATA)
    source.start_date = official.start_date = date(2026, 8, 1)
    match = _match(db, source, DataSource.UNDERSTAT, datetime.utcnow() - timedelta(days=1),
                   names=("United", "City"), countries=(None, "England"))
    for name, country in (("Manchester United", "England"), ("Newcastle United", "England"),
                          ("City", "Scotland")):
        team = Team(name=name, country=country, logo_url="https://example.invalid/crest.png",
                    data_source=DataSource.FOOTBALL_DATA)
        db.add(team)
        db.flush()
        db.add(Standing(season_id=official.id, team_id=team.id))
    db.commit()

    row = _results(client)[0]
    assert row["home_team"]["logo_url"] is None
    assert row["away_team"]["logo_url"] is None


def test_home_alias_studio_uses_canonical_events_not_homonymous_fixture(home_db):
    db, client = home_db
    kickoff = datetime.utcnow() - timedelta(days=1)
    cup = _season(db, DataSource.FOOTBALL_DATA, "FAC")
    league = _season(db, DataSource.FOOTBALL_DATA)
    decoy = _match(db, cup, DataSource.FOOTBALL_DATA, kickoff)
    root = _match(db, league, DataSource.FOOTBALL_DATA, kickoff, status="scheduled", scores=(None, None))
    alias = _match(db, _season(db, DataSource.PITCH_API), DataSource.PITCH_API,
                   kickoff, root=root.id, scores=(3, 1), status="FINISHED")
    for match, minute in ((decoy, 5), (root, 77)):
        shot = Event(match_id=match.id, team_id=match.home_team_id, type=EventType.SHOT,
                     minute=minute, outcome="SavedShot", data_source=DataSource.PITCH_API)
        shot.position = EventPosition(x=80, y=50)
        shot.shot = Shot(xg=0.1)
        db.add(shot)
    db.commit()

    row = _results(client)[0]
    assert row["id"] == alias.id
    details = client.get(f"/api/matches/{alias.id}", params={"source_match": True}).json()
    studio = client.get(f"/api/matches/{alias.id}/studio", params={"source_match": True}).json()
    insights = client.get(f"/api/matches/{alias.id}/insights").json()
    assert details["id"] == studio["match_id"] == insights["match_id"] == alias.id
    assert studio["linked_match_id"] == root.id
    assert studio["mode"] == "match"
    assert [shot["minute"] for shot in studio["shots"]] == [77]
    assert studio["shots"][0]["team"] == "home"
    assert studio["match"]["status"] == "finished"
    assert (studio["match"]["home_score"], studio["match"]["away_score"]) == (3, 1)

    canonical_event = db.query(Event).filter(Event.match_id == root.id).one()
    db.delete(canonical_event)
    db.commit()
    without_canonical_shots = client.get(
        f"/api/matches/{alias.id}/studio", params={"source_match": True},
    ).json()
    assert without_canonical_shots["mode"] == "none"
    assert without_canonical_shots["shots"] == []


def test_home_report_uses_one_canonical_match_without_mixing_events(home_db, monkeypatch):
    from app.api import matches as matches_api
    from app.services import match_report, shot_insights, studio

    db, client = home_db
    kickoff = datetime.utcnow() - timedelta(days=1)
    root = _match(db, _season(db, DataSource.FOOTBALL_DATA), DataSource.FOOTBALL_DATA, kickoff)
    alias = _match(
        db, _season(db, DataSource.PITCH_API), DataSource.PITCH_API,
        kickoff, root=root.id, scores=(3, 1),
    )
    decoy = _match(db, _season(db, DataSource.FOOTBALL_DATA, "FAC"), DataSource.FOOTBALL_DATA, kickoff)
    for match, team_id in ((root, root.home_team_id), (root, root.away_team_id), (decoy, decoy.home_team_id)):
        shot = Event(
            match_id=match.id, team_id=team_id, type=EventType.SHOT,
            minute=77, outcome="SavedShot", data_source=DataSource.PITCH_API,
        )
        shot.position = EventPosition(x=80, y=50)
        shot.shot = Shot(xg=0.1)
        db.add(shot)
    db.commit()
    monkeypatch.setattr(matches_api, "_insights_cached", lambda *args: {"available": True})
    monkeypatch.setattr(studio, "_recent_match_ids", lambda *args: [])
    monkeypatch.setattr(shot_insights, "season_baseline", lambda *args: ({}, {}, 0))
    monkeypatch.setattr(match_report, "build_report", lambda *args: {
        "generated_at": "2026-01-01", "teams": {}, "sample": {},
    })
    monkeypatch.setattr(match_report, "build_review", lambda report, actual: {
        "score": actual["score"],
        "home_shots": actual["agg"]["home"]["shots_for_total"],
        "away_shots": actual["agg"]["away"]["shots_for_total"],
    })
    matches_api._REPORT_CACHE.clear()

    default = client.get(f"/api/matches/{alias.id}/report").json()
    report = client.get(f"/api/matches/{alias.id}/report", params={"source_match": True}).json()
    assert default["review"]["home_shots"] == 0
    assert report["review"] == {"score": {"home": 3, "away": 1}, "home_shots": 1, "away_shots": 1}

    for shot in db.query(Event).filter(Event.match_id == root.id).all():
        db.delete(shot)
    db.commit()
    matches_api._REPORT_CACHE.clear()
    missing = client.get(f"/api/matches/{alias.id}/report", params={"source_match": True}).json()
    assert missing["available"] is False
    assert "Sem finalizações" in missing["notes"][0]

    for match, team_id in ((alias, alias.home_team_id), (root, root.away_team_id)):
        shot = Event(
            match_id=match.id, team_id=team_id, type=EventType.SHOT,
            minute=30, outcome="SavedShot", data_source=DataSource.PITCH_API,
        )
        shot.position = EventPosition(x=80, y=50)
        shot.shot = Shot(xg=0.1)
        db.add(shot)
    db.commit()
    preferred = client.get(f"/api/matches/{alias.id}/report", params={"source_match": True}).json()
    assert preferred["review"] == {"score": {"home": 3, "away": 1}, "home_shots": 1, "away_shots": 0}


def test_pagination_checks_ambiguity_beyond_two_page_boundaries(home_db, monkeypatch):
    db, client = home_db
    monkeypatch.setattr(recent_service, "_PAGE_SIZE", 1)
    now = datetime.utcnow() - timedelta(days=1)
    us = _season(db, DataSource.UNDERSTAT)
    pitch = _season(db, DataSource.PITCH_API)
    first = _match(db, us, DataSource.UNDERSTAT, now)
    middle = _match(db, pitch, DataSource.PITCH_API, now - timedelta(hours=5))
    last = _match(db, us, DataSource.UNDERSTAT, now - timedelta(hours=10))
    db.commit()

    assert [row["id"] for row in _results(client, limit=1)] == [first.id]
    assert [row["id"] for row in _results(client, skip=1, limit=1)] == [middle.id]
    assert [row["id"] for row in _results(client, skip=2, limit=1)] == [last.id]


def test_page_order_and_pairing_include_distant_canonical_siblings(home_db, monkeypatch):
    db, client = home_db
    monkeypatch.setattr(recent_service, "_PAGE_SIZE", 1)
    now = datetime.utcnow() - timedelta(days=1)
    us = _season(db, DataSource.UNDERSTAT)
    pitch = _season(db, DataSource.PITCH_API)
    fd = _season(db, DataSource.FOOTBALL_DATA)
    root = _match(db, fd, DataSource.FOOTBALL_DATA, now - timedelta(days=20))
    _match(db, pitch, DataSource.PITCH_API, now, root=root.id)
    canonical_us = _match(db, us, DataSource.UNDERSTAT, now - timedelta(days=20), root=root.id)
    independent = _match(db, pitch, DataSource.PITCH_API, now - timedelta(hours=1),
                         names=("Independent", "Opponent"))
    duplicate = _match(db, pitch, DataSource.PITCH_API, now - timedelta(days=20),
                       names=("Chelsea", "Arsenal"))
    db.commit()

    # The canonical group already contains PitchAPI, so the extra PitchAPI row
    # must not be absorbed, even though its kickoff and names coincide.
    expected = [independent.id, duplicate.id, canonical_us.id]
    assert [row["id"] for row in _results(client, limit=3)] == expected
    assert [row["id"] for row in _results(client, skip=1, limit=2)] == expected[1:]


def test_small_page_does_not_load_all_historical_matches(home_db, monkeypatch):
    db, client = home_db
    monkeypatch.setattr(recent_service, "_PAGE_SIZE", 4)
    now = datetime.utcnow() - timedelta(days=1)
    us = _season(db, DataSource.UNDERSTAT)
    for day in range(100):
        _match(db, us, DataSource.UNDERSTAT, now - timedelta(days=day),
               names=(f"Home {day}", f"Away {day}"))
    db.commit()
    db.expunge_all()
    loaded = set()

    def record_match(session, instance):
        if isinstance(instance, Match):
            loaded.add(instance.id)

    event.listen(db, "loaded_as_persistent", record_match)
    try:
        assert len(_results(client, limit=2)) == 2
    finally:
        event.remove(db, "loaded_as_persistent", record_match)
    assert len(loaded) < 20
