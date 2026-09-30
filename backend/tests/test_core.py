import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.db.models import User, UserRole
from app.core.auth import hash_password

SQLITE_URL = "sqlite:///./test_scoutvision.db"


@pytest.fixture()
def db_engine():
    engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(engine)


@pytest.fixture()
def db_session(db_engine):
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    sess = TestingSession()
    try:
        yield sess
    finally:
        sess.close()


def test_user_password_and_role(db_session):
    u = User(email="a@b.com", hashed_password=hash_password("pw123"), role=UserRole.ADMIN)
    db_session.add(u)
    db_session.commit()
    from app.core.auth import verify_password
    assert verify_password("pw123", u.hashed_password) is True
    assert verify_password("wrong", u.hashed_password) is False
    assert u.role == UserRole.ADMIN


def test_token_encode_decode_roundtrip():
    from app.core.auth import create_access_token, decode_token
    t = create_access_token(42, UserRole.USER)
    payload = decode_token(t)
    assert payload is not None
    assert payload.sub == 42
    assert payload.role == UserRole.USER


def test_predict_features_produce_probability_between_0_and_1():
    from app.ml.features import (
        PredictionContext, extract_features, features_to_array,
    )
    from app.ml.models import model_store
    ctx = PredictionContext(
        player_id=1, team_id=2, opponent_team_id=3, is_home=True,
        player_stats=None, team_stats=None, opponent_stats=None,
        opponent_weaknesses=[], player_zone_stats=[],
    )
    feats = extract_features(ctx)
    X = features_to_array(feats)
    for target in ["shot", "shot_on_target", "goal", "goal_involvement"]:
        prob, pos, neg = model_store.predict(X, target)
        assert 0.0 <= prob <= 1.0
        assert isinstance(pos, list) and isinstance(neg, list)


def test_utils_per90_and_clamp():
    from app.services.utils import per90, clamp, safe_div
    assert per90(3, 90) == pytest.approx(3.0)
    assert per90(1, 0) == 0.0
    assert clamp(1.5, 0, 1) == 1.0
    assert clamp(-2, 0, 1) == 0.0
    assert safe_div(1, 0, 42) == 42


def test_zone_opportunity_formula_and_matchup_score_range():
    from app.services.zones import compute_zone_opportunities
    from app.db.models import PlayerZoneStatistics, DefensiveWeakness, PitchZone
    # Build fake zone stats & weaknesses directly as objects using db model constructor (no session)
    pzs = [
        PlayerZoneStatistics(
            player_id=1, zone=PitchZone.CENTRAL_BOX,
            zone_frequency_pct=30.0, offensive_strength=0.7,
        ),
        PlayerZoneStatistics(
            player_id=1, zone=PitchZone.OPP_LEFT_CHANNEL,
            zone_frequency_pct=18.0, offensive_strength=0.4,
        ),
    ]
    dws = [
        DefensiveWeakness(team_id=2, zone=PitchZone.CENTRAL_BOX, weakness_score=0.8),
        DefensiveWeakness(team_id=2, zone=PitchZone.OPP_LEFT_CHANNEL, weakness_score=0.4),
    ]
    out = compute_zone_opportunities(pzs, dws)
    assert len(out) == 18
    best = out[0]
    assert best["opportunity_score"] > 0
    # Best should be central_box given high scores
    assert best["zone"] == PitchZone.CENTRAL_BOX
    # Matchup
    from app.services.matchups import compute_player_matchup
    from app.db.models import Player
    p1 = Player(id=1, last_name="A", position="ST")
    p2 = Player(id=2, last_name="B", position="CB")
    res = compute_player_matchup(p1, p2, None, None)
    assert 0.0 <= res["score"] <= 1.0
    assert isinstance(res["strengths"], list)
    assert isinstance(res["weaknesses"], list)
