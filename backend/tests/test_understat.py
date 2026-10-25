"""Testes da integração Understat.

Cobrem:
- coleta/mapeamento (funções puras do serviço de sincronização);
- persistência no banco e idempotência (cliente Understat falso, sem rede);
- API (/api/understat/*) sobre um banco SQLite em memória.

Nenhum teste acessa a rede nem o banco Neon de produção.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.db.models import (
    DataSource, Event, EventPosition, EventType, Match, Player, PlayerStatistics,
    Season, Shot, Team, TeamMatchStatistics, TeamStatistics, Competition,
)
from app.main import app as fastapi_app
from app.services import understat_sync as us
from app.vendor.understat import Understat # For typing or reference if needed


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False)
    sess = TestingSession()

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


def _count(db, model, **filters):
    stmt = select(func.count()).select_from(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return db.scalar(stmt)


# ---------------------------------------------------------------------------
# Cliente Understat falso — payloads idênticos ao formato real
# ---------------------------------------------------------------------------
class FakeClient:
    async def league_teams(self, league, season):
        return [
            {"id": "89", "title": "Manchester United", "short_title": "Man Utd"},
            {"id": "87", "title": "Liverpool", "short_title": "Liverpool"},
        ]

    async def league_players(self, league, season):
        return [
            {
                "id": "101", "player_name": "Marcus Rashford", "team_id": "89",
                "team_title": "Manchester United", "games": "10", "time": "900",
                "goals": "5", "xG": "4.20", "assists": "2", "xA": "1.80",
                "shots": "30", "key_passes": "12", "yellow_cards": "1",
                "red_cards": "0", "position": "FW", "npg": "4", "npxG": "3.50",
                "xGChain": "5.00", "xGBuildup": "2.00",
            },
            {
                "id": "202", "player_name": "Mohamed Salah", "team_id": "87",
                "team_title": "Liverpool", "games": "10", "time": "880",
                "goals": "7", "xG": "6.10", "assists": "3", "xA": "2.90",
                "shots": "35", "key_passes": "15", "yellow_cards": "0",
                "red_cards": "0", "position": "FW", "npg": "6", "npxG": "5.40",
                "xGChain": "6.20", "xGBuildup": "2.50",
            },
        ]

    async def league_table(self, league, season):
        # [Team, M, W, D, L, G, GA, PTS, xG, NPxG, xGA, NPxGA, NPxGD, PPDA, OPPDA, DC, ODC, xPTS]
        return [
            ["Manchester United", 10, 6, 2, 2, 20, 10, 20, 15.50, 14.00, 10.20, 9.50, 4.50, 12.30, 14.10, 25, 18, 21.50],
            ["Liverpool", 10, 7, 1, 2, 24, 12, 22, 18.20, 16.80, 11.00, 10.10, 6.70, 11.10, 13.20, 28, 20, 23.40],
        ]

    async def league_results(self, league, season):
        return [
            {
                "id": "12345", "isResult": True,
                "h": {"id": "89", "title": "Manchester United", "short_title": "Man Utd"},
                "a": {"id": "87", "title": "Liverpool", "short_title": "Liverpool"},
                "goals": {"h": 2, "a": 1}, "xG": {"h": 1.8, "a": 1.1},
                "datetime": "2026-08-15 15:00:00",
            }
        ]

    async def league_fixtures(self, league, season):
        return [
            {
                "id": "99999", "isResult": False,
                "h": {"id": "87", "title": "Liverpool", "short_title": "Liverpool"},
                "a": {"id": "89", "title": "Manchester United", "short_title": "Man Utd"},
                "goals": {"h": None, "a": None}, "xG": {"h": None, "a": None},
                "datetime": "2026-12-01 17:30:00",
            }
        ]

    async def match_shots(self, match_id):
        return {
            "h": [
                {"id": "5001", "minute": "23", "result": "Goal", "X": "0.85",
                 "Y": "0.45", "xG": "0.42", "player": "Marcus Rashford",
                 "h_a": "h", "player_id": "101", "situation": "OpenPlay",
                 "shotType": "RightFoot", "player_assisted": "Mohamed Salah",
                 "lastAction": "Pass"},
                {"id": "5002", "minute": "40", "result": "MissedShots", "X": "0.72",
                 "Y": "0.60", "xG": "0.08", "player": "Marcus Rashford",
                 "h_a": "h", "player_id": "101", "situation": "OpenPlay",
                 "shotType": "LeftFoot", "player_assisted": None, "lastAction": "None"},
            ],
            "a": [
                {"id": "6001", "minute": "60", "result": "SavedShot", "X": "0.80",
                 "Y": "0.50", "xG": "0.15", "player": "Mohamed Salah",
                 "h_a": "a", "player_id": "202", "situation": "FromCorner",
                 "shotType": "LeftFoot", "player_assisted": None, "lastAction": "Cross"},
            ],
        }


# ---------------------------------------------------------------------------
# Coleta: funções puras
# ---------------------------------------------------------------------------
def test_table_columns_contract():
    # A ordem precisa bater com o retorno de get_league_table(with_headers=False).
    assert us.TABLE_COLUMNS == [
        "title", "matches", "wins", "draws", "losses", "goals_for", "goals_against",
        "points", "xg", "npxg", "xga", "npxga", "npxgd", "ppda", "oppda",
        "deep", "deep_allowed", "xpts",
    ]


def test_parse_datetime_and_period():
    assert us._parse_datetime("2026-08-15 15:00:00") == datetime(2026, 8, 15, 15, 0, 0)
    assert us._parse_datetime("2026-08-15T15:00:00") == datetime(2026, 8, 15, 15, 0, 0)
    assert us._parse_datetime(None) is None
    assert us._parse_datetime("") is None
    assert us._period_for(30) == "1H"
    assert us._period_for(45) == "1H"
    assert us._period_for(46) == "2H"
    assert us._period_for(90) == "2H"
    assert us._period_for(95) == "ET"


def test_team_row_from_table_maps_values():
    row = ["Manchester United", 10, 6, 2, 2, 20, 10, 20, 15.5, 14.0,
           10.2, 9.5, 4.5, 12.3, 14.1, 25, 18, 21.5]
    team = Team(id=1, name="Manchester United", data_source=DataSource.UNDERSTAT)
    out = us._team_row_from_table(team, season_id=7, table_row=row)
    assert out["team_id"] == 1
    assert out["season_id"] == 7
    assert out["matches_played"] == 10
    assert out["wins"] == 6 and out["draws"] == 2 and out["losses"] == 2
    assert out["goals_for"] == 20 and out["goals_against"] == 10
    assert out["xg_total"] == 15.5 and out["xga_total"] == 10.2
    assert out["xg_per_90"] == pytest.approx(1.55)
    assert out["points_per_game"] == pytest.approx(2.0)
    assert out["recent_form"]["points"] == 20


def test_player_row_maps_values():
    player = Player(id=3, first_name="Marcus", last_name="Rashford",
                    data_source=DataSource.UNDERSTAT)
    raw = {
        "games": "10", "time": "900", "goals": "5", "assists": "2",
        "shots": "30", "key_passes": "12", "xG": "4.20", "xA": "1.80",
        "position": "FW", "npg": "4", "npxG": "3.50", "xGChain": "5.00",
        "xGBuildup": "2.00", "yellow_cards": "1", "red_cards": "0",
        "team_title": "Manchester United",
    }
    out = us._player_row(player, season_id=7, raw=raw)
    assert out["player_id"] == 3
    assert out["minutes_played"] == 900
    assert out["goals"] == 5 and out["assists"] == 2 and out["shots"] == 30
    assert out["xg_total"] == 4.20 and out["xa_total"] == 1.80
    assert out["shots_per_90"] == pytest.approx(3.0)
    assert out["xg_per_90"] == pytest.approx(0.42)
    assert out["recent_form"]["position"] == "FW"
    assert out["recent_form"]["yellow_cards"] == 1


# ---------------------------------------------------------------------------
# Banco: persistência + idempotência
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sync_persists_real_data_and_is_idempotent(db_session):
    db = db_session

    first = await us.sync_understat_league(db, FakeClient(), "epl", 2026)
    assert first["teams"] == 2
    assert first["players"] == 2
    assert first["matches"] == 2  # 1 resultado + 1 jogo futuro
    assert first["shots"] == 3
    assert first["table_rows"] == 2
    assert first["tms_rows"] == 2
    assert first["shot_errors"] == 0
    assert first["shot_coverage"] == "1/1"

    assert _count(db, Team, data_source=DataSource.UNDERSTAT) == 2
    assert _count(db, Player, data_source=DataSource.UNDERSTAT) == 2
    assert _count(db, Match, data_source=DataSource.UNDERSTAT) == 2
    assert _count(db, Shot) == 3
    assert _count(db, Event, data_source=DataSource.UNDERSTAT) == 4  # 3 chutes + 1 gol
    assert _count(db, TeamStatistics) == 2
    assert _count(db, PlayerStatistics) == 2
    assert _count(db, TeamMatchStatistics) == 2

    # Competição/temporada criadas e marcadas como Understat.
    comp = db.scalar(select(Competition).where(Competition.external_id == "epl"))
    assert comp is not None and comp.data_source == DataSource.UNDERSTAT
    assert db.scalar(select(Season).where(Season.competition_id == comp.id)).name == "2026"

    # Coordenadas convertidas de 0..1 para 0..100 e xG preservado.
    pos = db.scalar(
        select(EventPosition)
        .join(Event, Event.id == EventPosition.event_id)
        .where(Event.external_id == "us-shot-12345-5001")
    )
    assert pos is not None
    assert pos.x == pytest.approx(85.0)
    assert pos.y == pytest.approx(45.0)

    goal_shot = db.scalar(select(Shot).where(Shot.is_goal.is_(True)))
    assert goal_shot is not None and goal_shot.xg == pytest.approx(0.42)

    # Agregado de chutes do time da casa (cobertura completa => aplicado).
    home = db.scalar(select(Team).where(Team.external_id == "89"))
    home_stats = db.scalar(
        select(TeamStatistics).where(TeamStatistics.team_id == home.id)
    )
    assert home_stats.shots == 2.0
    assert home_stats.shots_on_target == 1.0
    # Estatísticas da tabela preservadas (não foram sobrescritas por chutes).
    assert home_stats.wins == 6

    # Segunda execução: nada é duplicado e os agregados de chutes não são zerados.
    second = await us.sync_understat_league(db, FakeClient(), "epl", 2026)
    assert second["shots"] == 0  # partidas já tinham chutes coletados

    assert _count(db, Team, data_source=DataSource.UNDERSTAT) == 2
    assert _count(db, Player, data_source=DataSource.UNDERSTAT) == 2
    assert _count(db, Match, data_source=DataSource.UNDERSTAT) == 2
    assert _count(db, Shot) == 3
    assert _count(db, Event, data_source=DataSource.UNDERSTAT) == 4
    assert _count(db, TeamStatistics) == 2
    assert _count(db, PlayerStatistics) == 2
    assert _count(db, TeamMatchStatistics) == 2

    db.refresh(home_stats)
    assert home_stats.shots == 2.0
    assert home_stats.shots_on_target == 1.0


@pytest.mark.asyncio
async def test_sync_shots_only_is_idempotent(db_session):
    db = db_session
    await us.sync_understat_league(db, FakeClient(), "epl", 2026)

    counts = await us.sync_understat_league(db, FakeClient(), "epl", 2026, shots_only=True)
    assert counts["shots"] == 0  # nenhuma partida pendente de chutes
    assert _count(db, Shot) == 3
    assert _count(db, Event, data_source=DataSource.UNDERSTAT) == 4


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
def test_understat_endpoints_on_empty_db(client):
    r = client.get("/api/understat/leagues")
    assert r.status_code == 200
    body = r.json()
    assert body["default_season"] == 2026
    keys = {row["key"] for row in body["leagues"]}
    assert {"epl", "la_liga", "bundesliga", "serie_a", "ligue_1"} <= keys
    assert all(row["synced"] is False for row in body["leagues"])

    assert client.get("/api/understat/sync/status").status_code == 200
    assert client.get("/api/understat/league-table/epl").status_code == 404
    assert client.get("/api/understat/matches?league_key=epl").json() == []


def test_understat_sync_requires_admin(client):
    r = client.post("/api/understat/sync", params={"leagues": "epl"})
    assert r.status_code == 401


def test_understat_sync_rejects_invalid_league(client, db_session):
    from app.core.auth import create_access_token
    from app.db.models import User, UserRole

    admin = User(email="admin@example.com", hashed_password="x",
                 role=UserRole.ADMIN, is_active=True, full_name="admin")
    db_session.add(admin)
    db_session.commit()
    token = create_access_token(admin.id, UserRole.ADMIN)

    r = client.post(
        "/api/understat/sync",
        params={"leagues": "not_a_league"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_understat_endpoints_with_synced_data(db_session, client):
    await us.sync_understat_league(db_session, FakeClient(), "epl", 2026)
    db_session.commit()

    leagues = client.get("/api/understat/leagues").json()["leagues"]
    epl = next(row for row in leagues if row["key"] == "epl")
    assert epl["synced"] is True
    assert epl["competition_id"] is not None
    assert any(s["name"] == "2026" for s in epl["seasons"])

    table = client.get("/api/understat/league-table/epl").json()
    assert table["season"] == "2026"
    assert len(table["table"]) == 2
    assert table["table"][0]["team"] == "Liverpool"  # mais pontos por jogo
    assert table["table"][0]["points"] == 22

    stats = client.get("/api/understat/stats").json()
    assert stats["top_scorers"][0]["player"] == "Mohamed Salah"
    assert stats["top_scorers"][0]["goals"] == 7

    matches = client.get("/api/understat/matches", params={"league_key": "epl"}).json()
    assert len(matches) == 1
    match = matches[0]
    assert match["home_score"] == 2 and match["away_score"] == 1
    assert match["has_shots"] is True

    shots_resp = client.get(f"/api/understat/matches/{match['id']}/shots")
    assert shots_resp.status_code == 200
    shots = shots_resp.json()["shots"]
    assert len(shots) == 3
    assert all(s["player"] for s in shots)  # nome do jogador resolvido
    assert shots_resp.json()["summary"]["home_shots"] == 2
    assert shots_resp.json()["summary"]["away_xg"] == pytest.approx(0.15)

    events = client.get(f"/api/understat/matches/{match['id']}/events").json()
    assert len(events["goals"]) == 1

    team_id = table["table"][0]["team_id"]
    team_stats = client.get(f"/api/understat/teams/{team_id}/stats").json()
    assert team_stats["total_matches_played"] == 10


@pytest.mark.asyncio
async def test_understat_extended_stats_form_and_shot_fields(db_session, client):
    await us.sync_understat_league(db_session, FakeClient(), "epl", 2026)
    db_session.commit()

    leagues = client.get("/api/understat/leagues").json()["leagues"]
    epl = next(row for row in leagues if row["key"] == "epl")

    # estatísticas filtradas por competição: rankings + listas completas
    stats = client.get("/api/understat/stats", params={"competition_id": epl["competition_id"]}).json()
    assert stats["top_scorers"][0]["player"] == "Mohamed Salah"
    assert stats["top_scorers"][0]["player_id"]
    assert len(stats["teams"]) == 2
    assert {"player_id", "goals", "xg", "xg_diff", "shots"} <= set(stats["players"][0])

    # temporada inexistente não devolve dados de outras temporadas
    empty = client.get(
        "/api/understat/stats",
        params={"competition_id": epl["competition_id"], "season_id": 999999},
    ).json()
    assert empty["players"] == [] and empty["teams"] == []

    # chutes de partida trazem parte do corpo e situação
    match = client.get("/api/understat/matches", params={"league_key": "epl"}).json()[0]
    shots = client.get(f"/api/understat/matches/{match['id']}/shots").json()["shots"]
    assert all("body_part" in s and "situation" in s for s in shots)

    # forma recente: xG a favor + contra = xG total dos chutes da partida
    table = client.get("/api/understat/league-table/epl").json()["table"]
    team_id = table[0]["team_id"]
    form = client.get(f"/api/understat/teams/{team_id}/form").json()
    assert len(form["matches"]) == 1
    m = form["matches"][0]
    assert m["has_shots"] is True
    assert m["xg_for"] + m["xg_against"] == pytest.approx(sum(s["xg"] or 0 for s in shots), abs=0.02)
    assert client.get("/api/understat/teams/999999/form").status_code == 404

    # chutes do jogador no mesmo formato dos chutes de partida
    pid = stats["top_scorers"][0]["player_id"]
    player_shots = client.get(f"/api/understat/players/{pid}/shots").json()
    assert player_shots["player"] == "Mohamed Salah"
    assert all({"body_part", "period", "player", "situation"} <= set(s) for s in player_shots["shots"])
