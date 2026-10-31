"""Testes do endpoint /api/matches/{id}/studio (dados reais do Studio).

Banco SQLite em memória; nenhum acesso à rede nem ao Neon de produção.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.db.models import (
    Competition, DataSource, Event, EventPosition, EventType, Match, Player, Season, Shot, Team,
)
from app.main import app as fastapi_app
from app.services import studio


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


def _world(db, src=DataSource.UNDERSTAT):
    comp = Competition(external_id="epl", name="Premier League", code="PL", data_source=src)
    db.add(comp); db.flush()
    season = Season(competition_id=comp.id, name="2026", current=True, data_source=src)
    db.add(season); db.flush()
    home = Team(external_id=f"h-{src.value}", name="Arsenal", data_source=src)
    away = Team(external_id=f"a-{src.value}", name="Chelsea", data_source=src)
    db.add_all([home, away]); db.flush()
    return season, home, away


def _match(db, season, home, away, when, status="finished", hs=2, as_=1, src=DataSource.UNDERSTAT, ext="m1"):
    m = Match(external_id=ext, season_id=season.id, home_team_id=home.id, away_team_id=away.id,
              kickoff_time=when, status=status, home_score=hs, away_score=as_, data_source=src)
    db.add(m); db.flush()
    return m


def _shot(db, match, team, player, minute, outcome, xg, x, y, assisted=None, src=DataSource.UNDERSTAT, n=[0]):
    n[0] += 1
    e = Event(external_id=f"s{n[0]}", match_id=match.id, team_id=team.id, player_id=player.id,
              type=EventType.SHOT, minute=minute, outcome=outcome,
              details={"situation": "OpenPlay", "shot_type": "RightFoot", "assisted_by": assisted},
              data_source=src)
    e.position = EventPosition(x=x, y=y)
    e.shot = Shot(on_target=outcome in ("Goal", "SavedShot"), is_goal=outcome == "Goal",
                  situation="OpenPlay", shot_type="RightFoot", body_part="right_foot", xg=xg)
    db.add(e); db.flush()


def _player(db, name, team, ext, src=DataSource.UNDERSTAT):
    parts = name.split()
    p = Player(external_id=ext, first_name=" ".join(parts[:-1]), last_name=parts[-1], display_name=name,
               team_id=team.id, position="Forward", data_source=src)
    db.add(p); db.flush()
    return p


def test_match_with_shots_flips_away_and_derives_players(client, db_session):
    db = db_session
    season, home, away = _world(db)
    m = _match(db, season, home, away, datetime(2026, 10, 18, 14))
    saka = _player(db, "Bukayo Saka", home, "p1")
    odeg = _player(db, "Martin Odegaard", home, "p2")
    palmer = _player(db, "Cole Palmer", away, "p3")
    _shot(db, m, home, saka, 12, "Goal", 0.40, 88, 30, assisted="Martin Odegaard")
    _shot(db, m, home, saka, 30, "MissedShots", 0.10, 80, 60)
    _shot(db, m, away, palmer, 60, "SavedShot", 0.20, 85, 40)  # fonte: ataque p/ a direita
    db.commit()

    r = client.get(f"/api/matches/{m.id}/studio")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "match" and body["source"] == "understat"

    by_min = {s["minute"]: s for s in body["shots"]}
    assert (by_min[12]["x"], by_min[12]["y"], by_min[12]["team"]) == (88.0, 30.0, "home")
    # visitante é girado 180°: 85,40 -> 15,60 e o gol fica em x=0
    assert (by_min[60]["x"], by_min[60]["y"], by_min[60]["team"]) == (15.0, 60.0, "away")
    assert by_min[60]["end_x"] == 0.0 and by_min[60]["end_known"] is False
    assert by_min[12]["result"] == "goal" and by_min[30]["result"] == "off_target"
    assert by_min[60]["result"] == "saved" and by_min[12]["xgot"] is None

    players = {p["name"]: p for p in body["players"]}
    assert players["Bukayo Saka"]["match"]["goals"] == 1
    assert players["Bukayo Saka"]["match"]["shots"] == 2
    assert players["Bukayo Saka"]["match"]["xg"] == 0.5
    # assistente aparece mesmo sem chutar: 1 assistência, 1 passe p/ chute, xA = xG do chute
    assert players["Martin Odegaard"]["match"]["assists"] == 1
    assert players["Martin Odegaard"]["match"]["xa"] == 0.4

    assert body["heatmap"]["home"] and body["heatmap"]["away"]
    assert all(0 <= h["x"] <= 100 and 0 < h["intensity"] <= 1 for h in body["heatmap"]["home"])
    assert body["coverage"]["has_shots"] is True


def test_upcoming_match_uses_recent_form_of_each_team(client, db_session):
    db = db_session
    season, home, away = _world(db)
    old1 = _match(db, season, home, away, datetime(2026, 9, 1, 14), ext="o1")
    pl = _player(db, "Bukayo Saka", home, "p1")
    cp = _player(db, "Cole Palmer", away, "p3")
    _shot(db, old1, home, pl, 10, "Goal", 0.3, 90, 50)
    _shot(db, old1, away, cp, 20, "BlockedShot", 0.1, 82, 45)
    future = _match(db, season, home, away, datetime.utcnow() + timedelta(days=3),
                    status="scheduled", hs=None, as_=None, ext="f1")
    db.commit()

    body = client.get(f"/api/matches/{future.id}/studio").json()
    assert body["mode"] == "recent_form"
    assert body["recent_match_ids"]["home"] == [old1.id]
    sides = {s["team"] for s in body["shots"]}
    assert sides == {"home", "away"}
    assert any("Sem eventos desta partida" in n for n in body["coverage"]["notes"])


def test_finished_match_without_events_does_not_fall_back_to_recent_form(client, db_session):
    """Jogo que já aconteceu mas ainda sem chutes: NÃO mistura chutes de jogos anteriores."""
    db = db_session
    season, home, away = _world(db)
    old = _match(db, season, home, away, datetime(2026, 9, 1, 14), ext="o1")
    pl = _player(db, "Bukayo Saka", home, "p1")
    cp = _player(db, "Cole Palmer", away, "p3")
    _shot(db, old, home, pl, 10, "Goal", 0.3, 90, 50)
    _shot(db, old, away, cp, 20, "BlockedShot", 0.1, 82, 45)
    played = _match(db, season, home, away, datetime(2026, 10, 25, 14), ext="m2")  # finished, sem chutes
    db.commit()

    body = client.get(f"/api/matches/{played.id}/studio").json()
    assert body["mode"] == "none"
    assert body["shots"] == []
    assert body["recent_match_ids"] == {"home": [], "away": []}
    assert any("já terminou" in n for n in body["coverage"]["notes"])


def test_analysis_list_prioritizes_understat_and_dedupes_upcoming(client, db_session):
    """Análise: jogo passado só da Understat; futuro de qualquer fonte, sem duplicata."""
    db = db_session
    now = datetime.utcnow()
    us_season, us_home, us_away = _world(db)
    fd_season, fd_home, fd_away = _world(db, DataSource.FOOTBALL_DATA)
    everton = Team(external_id="ev", name="Everton FC", data_source=DataSource.FOOTBALL_DATA)
    fulham = Team(external_id="fu", name="Fulham FC", data_source=DataSource.FOOTBALL_DATA)
    db.add_all([everton, fulham]); db.flush()

    played_us = _match(db, us_season, us_home, us_away, now - timedelta(days=3), ext="u1")
    played_fd = _match(db, fd_season, fd_home, fd_away, now - timedelta(days=3), src=DataSource.FOOTBALL_DATA, ext="f1")
    future_us = _match(db, us_season, us_home, us_away, now + timedelta(days=3), status="scheduled", hs=None, as_=None, ext="u2")
    future_fd = _match(db, fd_season, fd_home, fd_away, now + timedelta(days=3), status="scheduled", hs=None, as_=None, src=DataSource.FOOTBALL_DATA, ext="f2")
    future_only_fd = _match(db, fd_season, everton, fulham, now + timedelta(days=4), status="scheduled", hs=None, as_=None, src=DataSource.FOOTBALL_DATA, ext="f3")
    db.commit()

    body = client.get("/api/matches", params={"scope": "all", "analysis": "true"}).json()
    ids = [m["id"] for m in body]
    assert played_us.id in ids and future_us.id in ids and future_only_fd.id in ids
    assert played_fd.id not in ids      # jogo passado de outra fonte fica fora da Análise
    assert future_fd.id not in ids      # duplicata do jogo futuro: fica a da Understat

    recent = client.get("/api/matches", params={"scope": "recent", "analysis": "true"}).json()
    assert [m["id"] for m in recent] == [played_us.id]


def test_excluded_competition_is_hidden_and_purged(client, db_session):
    """Brasileirão (BSA) foi removido: some das listagens e o purge apaga do banco."""
    from app.services.purge_competition import purge

    db = db_session
    now = datetime.utcnow()
    comp = Competition(external_id="bsa", name="Campeonato Brasileiro Série A", code="BSA",
                       data_source=DataSource.FOOTBALL_DATA)
    db.add(comp); db.flush()
    season = Season(competition_id=comp.id, name="2026", current=True, data_source=DataSource.FOOTBALL_DATA)
    db.add(season); db.flush()
    a = Team(external_id="fla", name="Flamengo", data_source=DataSource.FOOTBALL_DATA)
    b = Team(external_id="pal", name="Palmeiras", data_source=DataSource.FOOTBALL_DATA)
    db.add_all([a, b]); db.flush()
    _match(db, season, a, b, now + timedelta(days=2), status="scheduled", hs=None, as_=None,
           src=DataSource.FOOTBALL_DATA, ext="b1")
    db.commit()

    assert client.get("/api/matches", params={"scope": "upcoming"}).json() == []
    assert client.get("/api/matches", params={"scope": "all", "analysis": "true"}).json() == []
    assert client.get("/api/competitions").json() == []

    summary = purge(db)
    assert summary["competitions"] == 1 and summary["matches"] == 1 and summary["teams"] == 2
    assert db.query(Competition).count() == 0
    assert db.query(Match).count() == 0
    assert db.query(Team).count() == 0


def _history(db, season, home, away, hp, ap, count=6):
    """Jogos anteriores com chutes dos dois times (base do cálculo de insights)."""
    now = datetime.utcnow()
    for i in range(count):
        m = _match(db, season, home, away, now - timedelta(days=3 + i * 3), ext=f"h{i}")
        _shot(db, m, home, hp, 10, "Goal", 0.35, 94, 50)          # área central
        _shot(db, m, home, hp, 30, "SavedShot", 0.12, 88, 45)     # fora da área
        _shot(db, m, home, hp, 55, "MissedShots", 0.05, 75, 20)   # corredor
        _shot(db, m, away, ap, 20, "SavedShot", 0.2, 92, 40)      # o visitante finaliza de perto
        _shot(db, m, away, ap, 70, "BlockedShot", 0.06, 80, 60)


def test_insights_compute_zones_predictions_and_matchups_from_real_shots(client, db_session):
    db = db_session
    season, home, away = _world(db)
    hp = _player(db, "Bukayo Saka", home, "p1")
    ap = _player(db, "Cole Palmer", away, "p2")
    _history(db, season, home, away, hp, ap)
    target = _match(db, season, home, away, datetime.utcnow() + timedelta(days=2),
                    status="scheduled", hs=None, as_=None, ext="next")
    db.commit()

    body = client.get(f"/api/matches/{target.id}/insights").json()
    assert body["available"] is True
    assert body["sample"]["home_matches"] == 6 and body["sample"]["away_matches"] == 6

    # Zonas: 18 por time, pontuação entre 0 e 1; o visitante finaliza de perto, então a defesa do mandante tem fraqueza real.
    hw = body["zones"]["home_team_weaknesses"]
    assert len(hw) == 18 and all(0 <= z["weakness_score"] <= 1 for z in hw)
    assert any(z["xga_per_90"] > 0 for z in hw)
    # Zona em que ninguém finalizou (alas/meio-campo) não pode sair vermelha "na média".
    empty = [z for z in hw if z["zone"] in ("neutral_left_flank", "neutral_right_flank", "own_left_flank")]
    assert empty and all(z["weakness_score"] == 0 for z in empty)

    # Previsões: 4 alvos por jogador, probabilidades coerentes (gol <= chute).
    preds = body["predictions"]
    saka = {p["target"]: p for p in preds if p["player_name"] == "Bukayo Saka"}
    assert set(saka) == {"shot", "shot_on_target", "goal", "goal_involvement"}
    assert all(0 < p["probability"] < 1 for p in saka.values())
    assert saka["goal"]["probability"] <= saka["shot"]["probability"]
    assert saka["shot"]["venue"] == "home" and saka["shot"]["zone_opportunities"]
    assert saka["shot"]["shots_per_match"] == 3.0  # 3 chutes em cada um dos 6 jogos
    assert saka["shot"]["positive_factors"]

    # Confrontos com nomes e explicação.
    mu = body["matchups"]
    assert mu and all(m["attacker_name"] and 0 <= m["score"] <= 1 and m["weaknesses"] for m in mu)


def test_insights_unavailable_without_prior_shots(client, db_session):
    db = db_session
    season, home, away = _world(db)
    target = _match(db, season, home, away, datetime.utcnow() + timedelta(days=2),
                    status="scheduled", hs=None, as_=None, ext="next")
    db.commit()
    body = client.get(f"/api/matches/{target.id}/insights").json()
    assert body["available"] is False and body["notes"]


def test_insights_ignore_the_match_itself_and_later_games(client, db_session):
    """Jogo já disputado: só chutes ANTERIORES entram (sem vazar o próprio resultado)."""
    db = db_session
    season, home, away = _world(db)
    hp = _player(db, "Bukayo Saka", home, "p1")
    ap = _player(db, "Cole Palmer", away, "p2")
    played = _match(db, season, home, away, datetime.utcnow() - timedelta(days=1), ext="played")
    _shot(db, played, home, hp, 10, "Goal", 0.9, 95, 50)
    db.commit()
    assert client.get(f"/api/matches/{played.id}/insights").json()["available"] is False


def test_football_data_match_links_to_understat_twin(client, db_session):
    """Partida do football-data sem eventos puxa os chutes da mesma partida no Understat."""
    db = db_session
    season_u, home_u, away_u = _world(db, DataSource.UNDERSTAT)
    when = datetime(2026, 10, 18, 14)
    twin = _match(db, season_u, home_u, away_u, when, ext="u1")
    saka = _player(db, "Bukayo Saka", home_u, "p1")
    _shot(db, twin, home_u, saka, 12, "Goal", 0.4, 88, 30)

    comp = Competition(external_id="PL", name="Premier League", code="PL", data_source=DataSource.FOOTBALL_DATA)
    db.add(comp); db.flush()
    season_f = Season(competition_id=comp.id, name="2026/27", data_source=DataSource.FOOTBALL_DATA)
    db.add(season_f); db.flush()
    home_f = Team(external_id="57", name="Arsenal FC", data_source=DataSource.FOOTBALL_DATA)
    away_f = Team(external_id="61", name="Chelsea FC", data_source=DataSource.FOOTBALL_DATA)
    db.add_all([home_f, away_f]); db.flush()
    fd = _match(db, season_f, home_f, away_f, when + timedelta(hours=1), src=DataSource.FOOTBALL_DATA, ext="fd1")
    db.commit()

    body = client.get(f"/api/matches/{fd.id}/studio").json()
    assert body["mode"] == "match"
    assert body["linked_match_id"] == twin.id
    assert body["source"] == "understat"
    assert len(body["shots"]) == 1


def test_no_shots_anywhere_returns_none_mode_and_404_for_unknown(client, db_session):
    db = db_session
    season, home, away = _world(db)
    m = _match(db, season, home, away, datetime(2026, 10, 18, 14))
    db.commit()
    body = client.get(f"/api/matches/{m.id}/studio").json()
    assert body["mode"] == "none" and body["shots"] == []
    assert body["heatmap"] == {"kind": "shots_xg", "home": [], "away": []}
    assert client.get("/api/matches/99999/studio").status_code == 404


def test_name_helpers():
    assert studio.norm_team("Arsenal FC") == studio.norm_team("Arsenal")
    assert studio._same_team_name(studio.norm_team("FC Bayern München"), studio.norm_team("Bayern Munich"))
    assert studio._same_person("m salah", "mohamed salah")
    assert not studio._same_person("bruno fernandes", "bruno guimaraes")
    assert studio._flip(80, 30, True) == (20.0, 70.0)
