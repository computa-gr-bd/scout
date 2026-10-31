from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.core.auth import get_current_user
from app.db.models import DataSource, Match, Season, Team
from app.repositories.repositories import (
    MatchRepository, TeamRepository, TeamStatisticsRepository, PlayerRepository
)
from app.services.crests import resolve_crest
from app.services.scope import excluded_season_ids
from app.services.studio import _same_team_name, norm_team
from app.schemas import (
    MatchOut, MatchDetailedOut, MatchAnalysisOut, PredictionGenerateRequest,
    PredictionGenerateResponse, MatchTeamPreview, LineupPlayer,
)

router = APIRouter(tags=["matches"])
match_repo = MatchRepository()
team_repo = TeamRepository()
ts_repo = TeamStatisticsRepository()
player_repo = PlayerRepository()


def _logo_index(db: Session) -> Dict[str, str]:
    """Escudos conhecidos por nome normalizado (times da Understat vêm sem logo)."""
    idx: Dict[str, str] = {}
    for name, url in db.execute(select(Team.name, Team.logo_url).where(Team.logo_url.isnot(None))).all():
        if url:
            idx.setdefault(norm_team(name), url)
    return idx


def _lookup_logo(team: Optional[Team], idx: Optional[Dict[str, str]]) -> Optional[str]:
    if team is None:
        return None
    if team.logo_url or not idx:
        return resolve_crest(team.name, team.logo_url)
    key = norm_team(team.name)
    url = idx.get(key)
    if url is None:
        for other_key, other_url in idx.items():
            if _same_team_name(key, other_key):
                url = other_url
                break
    return resolve_crest(team.name, url)


def _to_match_out(m: Match, logo_idx: Optional[Dict[str, str]] = None) -> MatchOut:
    return MatchOut(
        id=m.id,
        season_id=m.season_id,
        competition_name=(m.season.competition.name if (m.season and m.season.competition) else None),
        round_name=m.round_name,
        matchday=m.matchday,
        kickoff_time=m.kickoff_time,
        status=m.status,
        home_team=MatchTeamPreview(id=m.home_team.id, name=m.home_team.name,
                                    short_name=m.home_team.short_name, logo_url=_lookup_logo(m.home_team, logo_idx))
                 if m.home_team else MatchTeamPreview(id=m.home_team_id, name="?", short_name=None),
        away_team=MatchTeamPreview(id=m.away_team.id, name=m.away_team.name,
                                    short_name=m.away_team.short_name, logo_url=_lookup_logo(m.away_team, logo_idx))
                 if m.away_team else MatchTeamPreview(id=m.away_team_id, name="?", short_name=None),
        home_score=m.home_score, away_score=m.away_score,
        stadium_name=(m.stadium.name if m.stadium else None),
        referee=m.referee,
        data_source=m.data_source,
    )


def _same_fixture(a: Match, b: Match) -> bool:
    if not (a.home_team and a.away_team and b.home_team and b.away_team):
        return False
    if abs(a.kickoff_time - b.kickoff_time) > timedelta(days=1):
        return False
    return (_same_team_name(norm_team(a.home_team.name), norm_team(b.home_team.name))
            and _same_team_name(norm_team(a.away_team.name), norm_team(b.away_team.name)))


def _list_analysis_matches(db: Session, scope: str, skip: int, limit: int,
                           competition_id: Optional[int], team_id: Optional[int]) -> List[Match]:
    """Partidas da tela de Análise.

    * Jogos que JÁ ACONTECERAM: só Understat e finalizados (têm chutes e gols reais).
    * Jogos FUTUROS: qualquer fonte (a análise pré-jogo usa a forma recente dos times).
    Se o mesmo jogo existir em duas fontes, fica a versão da Understat.
    """
    now = datetime.utcnow()
    base = [Match.season_id.notin_(excluded_season_ids()), Match.canonical_match_id.is_(None)]
    if competition_id:
        base.append(Match.season_id.in_(select(Season.id).where(Season.competition_id == competition_id)))
    if team_id:
        base.append(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
    opts = (selectinload(Match.home_team), selectinload(Match.away_team),
            selectinload(Match.season).selectinload(Season.competition))

    def _fetch(cond, order, n):
        q = select(Match).options(*opts).where(cond, *base).order_by(order).limit(n)
        return list(db.scalars(q).all())

    pool = max(limit * 2, 40)  # folga para as duplicatas removidas abaixo
    upcoming = _fetch(Match.kickoff_time >= now, Match.kickoff_time, pool) if scope in ("upcoming", "all") else []
    played = _fetch(
        and_(Match.kickoff_time < now, Match.status == "finished", Match.data_source == DataSource.UNDERSTAT),
        Match.kickoff_time.desc(), pool,
    ) if scope in ("recent", "all") else []

    ordered = upcoming + played
    kept: List[Match] = []
    for m in sorted(ordered, key=lambda x: 0 if x.data_source == DataSource.UNDERSTAT else 1):
        if not any(_same_fixture(m, k) for k in kept):
            kept.append(m)
    kept_ids = {m.id for m in kept}
    final = [m for m in ordered if m.id in kept_ids]
    return final[skip: skip + limit]


@router.get("/matches", response_model=List[MatchOut])
def list_matches(scope: str = Query("upcoming", pattern="^(upcoming|recent|all)$"),
                 competition_id: Optional[int] = None,
                 team_id: Optional[int] = None,
                 skip: int = 0, limit: int = 50,
                 analysis: bool = Query(False, description="Lista da tela de Análise: jogos passados só da "
                                                           "Understat; jogos futuros de qualquer fonte."),
                 db: Session = Depends(get_db)):
    if analysis:
        matches = _list_analysis_matches(db, scope, skip, limit, competition_id, team_id)
        idx = _logo_index(db)
        return [_to_match_out(m, idx) for m in matches]
    if scope == "upcoming":
        matches = match_repo.upcoming(db, skip=skip, limit=limit,
                                      competition_id=competition_id, team_id=team_id)
    elif scope == "recent":
        matches = match_repo.recent(db, skip=skip, limit=limit, team_id=team_id)
    else:
        filters = [
            Match.season_id.notin_(excluded_season_ids()),
            Match.canonical_match_id.is_(None),
        ]
        if competition_id:
            sub = select(Season.id).where(Season.competition_id == competition_id)
            filters.append(Match.season_id.in_(sub))
        if team_id:
            filters.append(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
        matches = match_repo.list(db, skip=skip, limit=limit, filters=filters,
                                  order_by=Match.kickoff_time.desc())
        # eager-load teams for display
        ids = [m.id for m in matches]
        if ids:
            q = select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team),
                                   selectinload(Match.season)).where(Match.id.in_(ids))
            matches = list(db.scalars(q).all())
    idx = _logo_index(db)
    return [_to_match_out(m, idx) for m in matches]


@router.get("/matches/{match_id}", response_model=MatchDetailedOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = match_repo.get_detailed(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    if m.canonical_match_id is not None:
        m = match_repo.get_detailed(db, m.canonical_match_id)
        if not m:
            raise HTTPException(404, "Canonical match not found")
    out = _to_match_out(m, _logo_index(db))  # escudos também para times da Understat
    # Pre-load all lineup players in a single query (avoid N+1).
    player_ids = [lu.player_id for lu in m.lineups]
    players_by_id = {}
    if player_ids:
        from sqlalchemy import select as _sel
        from app.db.models import Player as _Player
        rows = db.scalars(_sel(_Player).where(_Player.id.in_(player_ids))).all()
        players_by_id = {p.id: p for p in rows}
    lineups_out: Dict[str, List[LineupPlayer]] = {
        "home": [], "away": [],
    }
    home_id = m.home_team_id
    away_id = m.away_team_id
    for lu in m.lineups:
        side = "home" if lu.team_id == home_id else "away"
        p = players_by_id.get(lu.player_id)
        pname = (p.last_name if p else None) or (p.display_name if p else None) or "?"
        lineups_out[side].append(LineupPlayer(
            player_id=lu.player_id, player_name=pname,
            is_starter=lu.is_starter, position=lu.position,
            shirt_number=lu.shirt_number, minutes_played=lu.minutes_played,
        ))
    return MatchDetailedOut(
        **out.model_dump(),
        lineups=lineups_out,
        events=[],
    )


@router.get("/matches/{match_id}/analysis", response_model=MatchAnalysisOut)
def get_match_analysis(match_id: int, db: Session = Depends(get_db)):
    m = match_repo.get(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    # Prefer the match's own season for aggregate stats; fall back to any
    # available row (handled inside for_team) so StatsBomb teams are not
    # silently reported as missing.
    home = ts_repo.for_team(db, m.home_team_id, season_id=m.season_id)
    away = ts_repo.for_team(db, m.away_team_id, season_id=m.season_id)
    if home is None:
        home = ts_repo.for_team(db, m.home_team_id)
    if away is None:
        away = ts_repo.for_team(db, m.away_team_id)
    h2h = match_repo.head_to_head(db, m.home_team_id, m.away_team_id, limit=6)
    h2h_out = [
        {
            "match_id": x.id,
            "kickoff": x.kickoff_time,
            "home_id": x.home_team_id,
            "away_id": x.away_team_id,
            # Nomes/escudos: sem eles a tela caía em "Time <id>" genérico.
            "home_name": x.home_team.name if x.home_team else None,
            "away_name": x.away_team.name if x.away_team else None,
            "home_short_name": x.home_team.short_name if x.home_team else None,
            "away_short_name": x.away_team.short_name if x.away_team else None,
            "home_logo_url": resolve_crest(x.home_team.name if x.home_team else None, x.home_team.logo_url if x.home_team else None),
            "away_logo_url": resolve_crest(x.away_team.name if x.away_team else None, x.away_team.logo_url if x.away_team else None),
            "home_score": x.home_score,
            "away_score": x.away_score,
        } for x in h2h
    ]
    form: Dict[str, Any] = {
        "home": (home.recent_form if home else []),
        "away": (away.recent_form if away else []),
    }
    # Standings availability for the match's season.
    from app.db.models import Standing as _Standing
    standings_available = db.query(_Standing).filter(_Standing.season_id == m.season_id).count() > 0
    # Lineups availability (official or estimated possible).
    from app.db.models import Lineup as _Lineup
    lineups_available = db.query(_Lineup).filter(_Lineup.match_id == match_id).count() > 0
    return MatchAnalysisOut(
        match_id=match_id,
        home_team_stats=home, away_team_stats=away,
        h2h_recent=h2h_out, form=form,
        key_stats={
            "home_shots_per_90": getattr(home, "shots_per_90", None),
            "away_shots_per_90": getattr(away, "shots_per_90", None),
            "home_xg_per_90": getattr(home, "xg_per_90", None),
            "away_xg_per_90": getattr(away, "xg_per_90", None),
            "home_xga_per_90": getattr(home, "xga_per_90", None),
            "away_xga_per_90": getattr(away, "xga_per_90", None),
            "home_points_per_game": getattr(home, "points_per_game", None),
            "away_points_per_game": getattr(away, "points_per_game", None),
        },
        data_availability={
            "team_stats": bool(home or away),
            "home_team_stats": home is not None,
            "away_team_stats": away is not None,
            "lineups": lineups_available,
            "standings": standings_available,
            "h2h": len(h2h_out) > 0,
        },
    )


@router.get("/matches/{match_id}/predictions")
def get_match_predictions(match_id: int, target: Optional[str] = None,
                          db: Session = Depends(get_db)):
    from app.repositories.repositories import MatchPredictionRepository
    pr = MatchPredictionRepository()
    preds = pr.for_match(db, match_id, target=target)
    return {
        "match_id": match_id,
        "count": len(preds),
        "items": [
            {
                "id": p.id, "player_id": p.player_id, "target": p.target,
                "probability": p.probability, "baseline_probability": p.baseline_probability,
                "venue": p.venue, "confidence": p.confidence,
                "factors": p.factors, "zones": p.zones,
            }
            for p in preds
        ],
    }


# Cache curto: o cálculo lê dezenas de partidas, e a tela pede ao abrir cada partida.
_INSIGHTS_CACHE: Dict[int, tuple] = {}
_INSIGHTS_TTL = 300  # segundos


@router.get("/matches/{match_id}/insights")
def get_match_insights(match_id: int, db: Session = Depends(get_db)):
    """Zonas fracas, probabilidades por jogador e confrontos, calculados dos chutes reais (Understat).

    Público (não grava nada). `available=false` quando não há chutes anteriores para os times.
    """
    import time
    from app.services.shot_insights import match_insights

    cached = _INSIGHTS_CACHE.get(match_id)
    if cached and time.time() - cached[0] < _INSIGHTS_TTL:
        return cached[1]
    m = match_repo.get_detailed(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    result = match_insights(db, m)
    if result.get("available"):
        _INSIGHTS_CACHE[match_id] = (time.time(), result)
    return result


@router.get("/matches/{match_id}/zones")
def get_match_zones(match_id: int, db: Session = Depends(get_db)):
    from app.repositories.repositories import (DefensiveWeaknessRepository, PlayerZoneStatsRepository,
                                                PlayerRepository, Lineup)
    from sqlalchemy import select
    m = match_repo.get(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    dwr = DefensiveWeaknessRepository()
    home_w = [w for w in dwr.for_team(db, m.home_team_id)]
    away_w = [w for w in dwr.for_team(db, m.away_team_id)]

    # attackers from each team -> zone opportunities
    def team_attackers(tid):
        q = (select(Lineup.player_id).where(Lineup.match_id == match_id, Lineup.team_id == tid)
             .limit(8))
        return [pid for pid in db.scalars(q).all()]
    from app.services.zones import compute_zone_opportunities
    pzr = PlayerZoneStatsRepository()
    home_attack_zones = []
    for pid in team_attackers(m.away_team_id):
        pzs = pzr.for_player(db, pid)
        opps = compute_zone_opportunities(pzs, home_w)  # away attackers attack home defense
        if opps:
            home_attack_zones.append({"player_id": pid, "zones": opps[:5]})
    away_attack_zones = []
    for pid in team_attackers(m.home_team_id):
        pzs = pzr.for_player(db, pid)
        opps = compute_zone_opportunities(pzs, away_w)
        if opps:
            away_attack_zones.append({"player_id": pid, "zones": opps[:5]})
    return {
        "match_id": match_id,
        "home_team_weaknesses": [
            {"zone": w.zone.value, "weakness_score": w.weakness_score} for w in home_w
        ],
        "away_team_weaknesses": [
            {"zone": w.zone.value, "weakness_score": w.weakness_score} for w in away_w
        ],
        "opportunities_against_home": home_attack_zones,
        "opportunities_against_away": away_attack_zones,
    }


@router.get("/matches/{match_id}/lineups")
def get_match_lineups(match_id: int, db: Session = Depends(get_db)):
    """Escalação da partida (oficial quando existe, provável XI pelo elenco) + gols."""
    from app.services.lineups import match_lineups
    m = match_repo.get(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    payload = match_lineups(db, match_id)
    payload["home_team"] = {
        "id": m.home_team_id,
        "name": m.home_team.name if m.home_team else None,
        "logo_url": resolve_crest(m.home_team.name if m.home_team else None, m.home_team.logo_url if m.home_team else None),
    }
    payload["away_team"] = {
        "id": m.away_team_id,
        "name": m.away_team.name if m.away_team else None,
        "logo_url": resolve_crest(m.away_team.name if m.away_team else None, m.away_team.logo_url if m.away_team else None),
    }
    return payload


@router.get("/matches/{match_id}/studio")
def get_match_studio(match_id: int, db: Session = Depends(get_db)):
    """Dados reais para o ScoutVision Studio: chutes/xG, mapa de calor, escalação e fichas.

    Usa Understat/StatsBomb/football-data conforme o que existir no banco e
    informa em ``mode``/``coverage`` o que veio de fato (nada é simulado).
    """
    from app.services.studio import build_studio_payload
    payload = build_studio_payload(db, match_id)
    if payload is None:
        raise HTTPException(404, "Match not found")
    return payload


@router.get("/matches/{match_id}/tactical-analysis")
def get_tactical_analysis(match_id: int, db: Session = Depends(get_db)):
    from app.services.matchups import recommend_matchups
    from app.repositories.repositories import PlayerStatisticsRepository, Lineup
    from sqlalchemy import select, and_
    m = match_repo.get(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    # lineup ids
    def get_lineup_players(tid):
        q = (select(Lineup.player_id).where(and_(Lineup.match_id == match_id, Lineup.team_id == tid))
             .order_by(Lineup.is_starter.desc()).limit(11))
        return list(db.scalars(q).all())
    home_ids = get_lineup_players(m.home_team_id)
    away_ids = get_lineup_players(m.away_team_id)
    if not home_ids or not away_ids:
        return {"match_id": match_id, "matchups": [], "note": "Lineups not yet seeded for this match"}
    home_ps = {pid: player_repo.get(db, pid) for pid in home_ids}
    away_ps = {pid: player_repo.get(db, pid) for pid in away_ids}
    psr = PlayerStatisticsRepository()
    home_s = {pid: psr.for_player(db, pid) for pid in home_ids}
    away_s = {pid: psr.for_player(db, pid) for pid in away_ids}
    def attackers(ids, pos_map):
        atk_pos = {"FW", "ST", "RW", "LW", "CF", "AM"}
        return [pos_map[i] for i in ids if pos_map[i] and (pos_map[i].position or "").upper()[:2] in atk_pos] \
               or [pos_map[i] for i in ids[:4]]
    def defenders(ids, pos_map):
        def_pos = {"CB", "LB", "RB", "CDM", "GK"}
        return [pos_map[i] for i in ids if pos_map[i] and (pos_map[i].position or "").upper()[:2] in def_pos] \
               or [pos_map[i] for i in ids[-6:]]
    h_atk = attackers(home_ids, home_ps)
    h_def = defenders(home_ids, home_ps)
    a_atk = attackers(away_ids, away_ps)
    a_def = defenders(away_ids, away_ps)
    m1 = recommend_matchups(db, h_atk, a_def, home_s, away_s, top_n=5)
    m2 = recommend_matchups(db, a_atk, h_def, away_s, home_s, top_n=5)
    return {
        "match_id": match_id,
        "matchups": m1 + m2,
    }


@router.post("/predictions/generate", response_model=PredictionGenerateResponse)
def generate_predictions(payload: PredictionGenerateRequest,
                         db: Session = Depends(get_db),
                         current_user=Depends(get_current_user)):
    m = match_repo.get(db, payload.match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    from app.services.predictions import generate_match_predictions
    targets = [t for t in payload.targets if t in {"shot", "shot_on_target", "goal", "goal_involvement"}]
    if not targets:
        targets = ["shot", "goal"]
    result = generate_match_predictions(db, m, targets,
                                         include_zone_details=payload.include_zone_details,
                                         include_matchups=payload.include_matchups)
    return PredictionGenerateResponse(**result)
