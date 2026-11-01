"""Escudos: o mesmo clube é achado entre fontes (football-data ↔ Understat)."""
from app.services import crests


def _fake_index(monkeypatch, pairs):
    from app.services.studio import norm_team  # noqa: F401  (garante o import)

    tokens = [(crests._tokens(n), u) for n, u in pairs]
    monkeypatch.setattr(crests, "_index", lambda refresh=False: {"tokens": tokens, "names": dict(pairs)})


def test_resolve_prefers_explicit_logo(monkeypatch):
    _fake_index(monkeypatch, [("FC Barcelona", "http://x/barca.png")])
    assert crests.resolve_crest("Barcelona", "http://own/logo.png") == "http://own/logo.png"


def test_cross_source_names_match(monkeypatch):
    _fake_index(monkeypatch, [
        ("Club Atlético de Madrid", "http://x/atm.png"),
        ("Real Madrid CF", "http://x/rm.png"),
        ("FC Internazionale Milano", "http://x/inter.png"),
        ("AC Milan", "http://x/milan.png"),
        ("RB Leipzig", "http://x/rb.png"),
    ])
    assert crests.resolve_crest("Atletico Madrid", None) == "http://x/atm.png"
    assert crests.resolve_crest("Real Madrid", None) == "http://x/rm.png"
    assert crests.resolve_crest("Inter", None) == "http://x/inter.png"
    assert crests.resolve_crest("Milan", None) == "http://x/milan.png"
    assert crests.resolve_crest("RasenBallsport Leipzig", None) == "http://x/rb.png"


def test_different_clubs_do_not_collide(monkeypatch):
    _fake_index(monkeypatch, [("Manchester City FC", "http://x/city.png")])
    assert crests.db_crest_for_name("Manchester United") is None
