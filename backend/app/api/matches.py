from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.core.auth import get_current_user
from app.db.models import Match
from app.repositories.repositories import (
    MatchRepository, TeamRepository, TeamStatisticsRepository, PlayerRepository
)
from app.schemas import (
    MatchOut, MatchDetailedOut, MatchAnalysisOut, PredictionGenerateRequest,
    PredictionGenerateResponse, MatchTeamPreview, LineupPlayer,
)

router = APIRouter(tags=["matches"])
match_repo = MatchRepository()
team_repo = TeamRepository()
ts_repo = TeamStatisticsRepository()
player_repo = PlayerRepository()


def _to_match_out(m: Match) -> MatchOut:
    return MatchOut(
        id=m.id,
        season_id=m.season_id,
        competition_name=(m.season.competition.name if (m.season and m.season.competition) else None),
        round_name=m.round_name,
        matchday=m.matchday,
        kickoff_time=m.kickoff_time,
        status=m.status,
        home_team=MatchTeamPreview(id=m.home_team.id, name=m.home_team.name,
                                    short_name=m.home_team.short_name, logo_url=m.home_team.logo_url)
                 if m.home_team else MatchTeamPreview(id=m.home_team_id, name="?", short_name=None),
        away_team=MatchTeamPreview(id=m.away_team.id, name=m.away_team.name,
                                    short_name=m.away_team.short_name, logo_url=m.away_team.logo_url)
                 if m.away_team else MatchTeamPreview(id=m.away_team_id, name="?", short_name=None),
        home_score=m.home_score, away_score=m.away_score,
        stadium_name=(m.stadium.name if m.stadium else None),
        referee=m.referee,
        data_source=m.data_source,
    )


@router.get("/matches", response_model=List[MatchOut])
def list_matches(scope: str = Query("upcoming", pattern="^(upcoming|recent|all)$"),
                 competition_id: Optional[int] = None,
                 team_id: Optional[int] = None,
                 skip: int = 0, limit: int = 50,
                 db: Session = Depends(get_db)):
    if scope == "upcoming":
        matches = match_repo.upcoming(db, skip=skip, limit=limit,
                                      competition_id=competition_id, team_id=team_id)
    elif scope == "recent":
        matches = match_repo.recent(db, skip=skip, limit=limit, team_id=team_id)
    else:
        filters = []
        if competition_id:
            from app.db.models import Season
            from sqlalchemy import select, and_
            sub = select(Season.id).where(Season.competition_id == competition_id)
            filters.append(Match.season_id.in_(sub))
        if team_id:
            from sqlalchemy import or_
            filters.append(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
        matches = match_repo.list(db, skip=skip, limit=limit, filters=filters,
                                  order_by=Match.kickoff_time.desc())
        # eager-load teams for display
        from sqlalchemy.orm import selectinload
        from sqlalchemy import select as _s
        ids = [m.id for m in matches]
        if ids:
            q = _s(Match).options(selectinload(Match.home_team), selectinload(Match.away_team),
                                   selectinload(Match.season)).where(Match.id.in_(ids))
            matches = list(db.scalars(q).all())
    return [_to_match_out(m) for m in matches]


@router.get("/matches/{match_id}", response_model=MatchDetailedOut)
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = match_repo.get_detailed(db, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    out = _to_match_out(m)
    lineups_out: Dict[str, List[LineupPlayer]] = {
        "home": [], "away": [],
    }
    home_id = m.home_team_id
    away_id = m.away_team_id
    for lu in m.lineups:
        side = "home" if lu.team_id == home_id else "away"
        pname = (player_repo.get(db, lu.player_id).last_name) if player_repo.get(db, lu.player_id) else "?"
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
    home = ts_repo.for_team(db, m.home_team_id)
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
            "home_logo_url": x.home_team.logo_url if x.home_team else None,
            "away_logo_url": x.away_team.logo_url if x.away_team else None,
            "home_score": x.home_score,
            "away_score": x.away_score,
        } for x in h2h
    ]
    form: Dict[str, Any] = {
        "home": (home.recent_form if home else []),
        "away": (away.recent_form if away else []),
    }
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
        "logo_url": m.home_team.logo_url if m.home_team else None,
    }
    payload["away_team"] = {
        "id": m.away_team_id,
        "name": m.away_team.name if m.away_team else None,
        "logo_url": m.away_team.logo_url if m.away_team else None,
    }
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
