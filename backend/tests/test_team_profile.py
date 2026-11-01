"""Testes do endpoint /api/understat/teams/{id}/profile.

Banco SQLite em memória; nenhum acesso à rede nem ao Neon de produção.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.db.models import (
    Competition, DataSource, Event, EventPosition, EventType, Match, Player, PlayerStatistics,
    Season, Shot, Team,
)
from app.main import app as fastapi_app


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sess = sessionmaker(bind=engine, autoflush=False)()

    def override():
        yield sess

    fastapi_app.dependency_overrides[get_db] = override
    try:
        yield sess
    finally:
        fastapi_app.dependency_overrides.pop(get_db, None)
        sess.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    return TestClient(fastapi_app)


_counter = [0]


def _shot(db, match, team, player, minute, outcome, xg, x, y):
    _counter[0] += 1
    e = Event(external_id=f"s{_counter[0]}", match_id=match.id, team_id=team.id, player_id=player.id,
              type=EventType.SHOT, minute=minute, outcome=outcome, details={}, data_source=DataSource.UNDERSTAT)
    e.position = EventPosition(x=x, y=y)
    e.shot = Shot(on_target=outcome in ("Goal", "SavedShot"), is_goal=outcome == "Goal",
                  situation="OpenPlay", shot_type="RightFoot", body_part="right_foot", xg=xg)
    db.add(e)
    db.flush()


def _player(db, name, team, ext, src, position="Forward"):
    parts = name.split()
    p = Player(external_id=ext, first_name=" ".join(parts[:-1]), last_name=parts[-1], display_name=name,
               team_id=team.id, position=position, data_source=src)
    db.add(p)
    db.flush()
    return p


def _world(db):
    comp = Competition(external_id="epl", name="Premier League", code="PL", data_source=DataSource.UNDERSTAT)
    db.add(comp)
    db.flush()
    season = Season(competition_id=comp.id, name="2026", current=True, data_source=DataSource.UNDERSTAT)
    db.add(season)
    db.flush()
    us_arsenal = Team(external_id="u-ars", name="Arsenal", data_source=DataSource.UNDERSTAT)
    us_chelsea = Team(external_id="u-che", name="Chelsea", data_source=DataSource.UNDERSTAT)
    # Mesmo clube no football-data, com grafia diferente (é o id que a página de time recebe).
    fd_arsenal = Team(external_id="f-ars", name="Arsenal FC", data_source=DataSource.FOOTBALL_DATA)
    db.add_all([us_arsenal, us_chelsea, fd_arsenal])
    db.flush()
    return season, us_arsenal, us_chelsea, fd_arsenal


def test_profile_from_football_data_id_uses_understat_shots(client, db_session):
    db = db_session
    season, ars, che, fd_ars = _world(db)
    for i, (when, hs, as_) in enumerate([(datetime(2026, 9, 1, 15), 2, 1), (datetime(2026, 9, 15, 15), 0, 0)]):
        m = Match(external_id=f"m{i}", season_id=season.id, home_team_id=ars.id, away_team_id=che.id,
                  kickoff_time=when, status="finished", home_score=hs, away_score=as_,
                  data_source=DataSource.UNDERSTAT)
        db.add(m)
        db.flush()
        saka = db.query(Player).filter_by(external_id="p-saka").first() or _player(db, "Bukayo Saka", ars, "p-saka", DataSource.UNDERSTAT)
        pal = db.query(Player).filter_by(external_id="p-pal").first() or _player(db, "Cole Palmer", che, "p-pal", DataSource.UNDERSTAT)
        _shot(db, m, ars, saka, 12, "Goal", 0.40, 95, 50)      # ataque do Arsenal: área central
        _shot(db, m, che, pal, 60, "SavedShot", 0.20, 90, 50)  # chute sofrido: gira p/ a própria área
    saka = db.query(Player).filter_by(external_id="p-saka").one()
    db.add(PlayerStatistics(player_id=saka.id, season_id=season.id, scope="overall", matches_played=2,
                            minutes_played=180, goals=1, assists=0, shots=2, xg_total=0.8,
                            recent_form={"position": "F M S"}))
    fd_saka = _player(db, "Bukayo Saka", fd_ars, "f-saka", DataSource.FOOTBALL_DATA, position="Offence")
    db.commit()

    r = client.get(f"/api/understat/teams/{fd_ars.id}/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["team"]["id"] == fd_ars.id
    assert {ars.id, fd_ars.id} <= set(body["team_ids"])

    s = body["summary"]
    assert s["matches"] == 2 and (s["wins"], s["draws"], s["losses"]) == (1, 1, 0)
    assert s["xg_per_90"] == 0.4 and s["xga_per_90"] == 0.2
    assert s["shots_per_90"] == 1.0

    weak = {w["zone"]: w for w in body["weaknesses"]}
    assert weak["own_box"]["xga_per_90"] == 0.2 and weak["own_box"]["weakness_score"] > 0
    assert weak["neutral_midfield"]["weakness_score"] == 0.0  # zona sem nenhum chute: sem informação

    top = body["players"][0]
    assert top["name"] == "Bukayo Saka" and top["goals"] == 1 and top["games"] == 2
    assert top["fd_player_id"] == fd_saka.id and top["group"] == "att"

    # Elenco combinado: o cadastrado (football-data) com as estatísticas, sem duplicar o jogador da Understat.
    squad = [m for m in body["squad"] if m["name"] == "Bukayo Saka"]
    assert len(squad) == 1 and squad[0]["key"] == f"fd-{fd_saka.id}"
    assert squad[0]["goals"] == 1 and squad[0]["games"] == 2 and squad[0]["has_stats"] is True

    opp = [o for o in body["opportunities"] if o["player_name"] == "Bukayo Saka"]
    assert any(o["zone"] == "central_box" and o["opportunity_score"] > 0 for o in opp)
    assert [m["result"] for m in body["matches"]] == ["W", "D"]


def test_profile_by_understat_id_has_same_squad_and_standings(client, db_session):
    db = db_session
    season, ars, che, fd_ars = _world(db)
    m = Match(external_id="m0", season_id=season.id, home_team_id=ars.id, away_team_id=che.id,
              kickoff_time=datetime(2026, 9, 1, 15), status="finished", home_score=2, away_score=1,
              data_source=DataSource.UNDERSTAT)
    db.add(m)
    db.flush()
    saka_us = _player(db, "Bukayo Saka", ars, "p-saka", DataSource.UNDERSTAT)
    _player(db, "David Raya", fd_ars, "f-raya", DataSource.FOOTBALL_DATA, position="Goalkeeper")
    _shot(db, m, ars, saka_us, 12, "Goal", 0.40, 95, 50)
    db.add(PlayerStatistics(player_id=saka_us.id, season_id=season.id, scope="overall", matches_played=1,
                            minutes_played=90, goals=1, xg_total=0.4, recent_form={"position": "F"}))
    from app.db.models import TeamStatistics
    db.add_all([
        TeamStatistics(team_id=ars.id, season_id=season.id, scope="overall", matches_played=1, wins=1, draws=0,
                       losses=0, goals_for=2, goals_against=1),
        TeamStatistics(team_id=che.id, season_id=season.id, scope="overall", matches_played=1, wins=0, draws=0,
                       losses=1, goals_for=1, goals_against=2),
    ])
    db.commit()

    body = client.get(f"/api/understat/teams/{ars.id}/profile").json()
    names = {m["name"]: m for m in body["squad"]}
    assert set(names) == {"Bukayo Saka", "David Raya"}          # elenco inteiro, sem duplicar
    assert names["David Raya"]["group"] == "gk" and names["David Raya"]["has_stats"] is False
    assert names["Bukayo Saka"]["goals"] == 1 and names["Bukayo Saka"]["xg"] == 0.4
    assert [r["team_name"] for r in body["standings"]] == ["Arsenal", "Chelsea"]
    assert body["standings"][0]["points"] == 3 and body["standings"][0]["position"] == 1


def test_profile_without_shots_is_unavailable_not_invented(client, db_session):
    db = db_session
    _, _, _, fd_ars = _world(db)
    db.commit()
    r = client.get(f"/api/understat/teams/{fd_ars.id}/profile")
    assert r.status_code == 200
    assert r.json()["available"] is False and r.json()["players"] == []


def test_profile_unknown_team_is_404(client, db_session):
    assert client.get("/api/understat/teams/999999/profile").status_code == 404
