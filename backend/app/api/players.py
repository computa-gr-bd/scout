from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.repositories.repositories import (
    PlayerRepository, PlayerStatisticsRepository, PlayerZoneStatsRepository,
)
from app.schemas import (
    PlayerOut, PlayerDetailedOut, PlayerStatisticsOut, PlayerZoneStatsOut,
    ProbabilityPrediction,
)
from app.services.index_service import player_index_payload
from app.services.position_index import classify_role
from app.services.predictions import predict_for_player, TARGETS
from app.services.player_profile import (
    TOP5_CODES, decorate_players, derive_zone_stats, extras_from_stat, league_averages,
    next_match, order_subquery, recent_matches, team_league_map,
)
from app.db.models import Match, Player, PlayerStatistics

router = APIRouter(tags=["players"])
player_repo = PlayerRepository()
ps_repo = PlayerStatisticsRepository()
pzs_repo = PlayerZoneStatsRepository()

_ORDERS = {"goals": "goals", "assists": "assists", "xg": "xg", "minutes": "minutes"}

# Grupos de posição: o Understat usa siglas ("GK", "D", "M", "F", "S", combinadas por espaço,
# ex.: "F M S") e o football-data usa palavras ("Goalkeeper", "Defence", "Midfield", "Offence").
_POSITION_GROUPS = {
    # Understat: "D M S" (S = reserva, NÃO é atacante); FBref: "DF,MF"; football-data: palavras.
    "GK": (["GK"], ["goalkeeper"]),
    "DEF": (["D", "DF"], ["defen", "back"]),
    "MID": (["M", "MF"], ["midfield"]),
    "ATT": (["F", "FW"], ["offence", "forward", "winger", "striker"]),
}


def _position_clause(position: str):
    group = _POSITION_GROUPS.get(position.strip().upper())
    if group is None:  # valor livre (ex.: "CB"): comportamento antigo
        return Player.position.ilike(f"%{position}%")
    tokens, words = group
    clauses = []
    for t in tokens:
        clauses += [Player.position == t, Player.position.ilike(f"{t} %"),
                    Player.position.ilike(f"% {t}"), Player.position.ilike(f"% {t} %"),
                    Player.position.ilike(f"{t},%"), Player.position.ilike(f"%,{t}"),
                    Player.position.ilike(f"%,{t},%")]
    clauses += [Player.position.ilike(f"%{w}%") for w in words]
    return or_(*clauses)


@router.get("/players", response_model=List[PlayerOut])
def list_players(q: Optional[str] = None, position: Optional[str] = None,
                 team_id: Optional[int] = None, skip: int = 0, limit: int = 50,
                 top5: bool = False, league: Optional[str] = None, order: str = "name",
                 db: Session = Depends(get_db)):
    """Lista jogadores.

    * ``top5=true`` restringe aos jogadores de times das 5 ligas (PL, PD, BL1, SA, FL1);
      ``league=<código>`` restringe a uma delas (e já implica ``top5``).
    * ``order``: ``name`` (padrão), ``goals``, ``assists``, ``xg`` ou ``minutes``.
    """
    league_map: Optional[Dict[int, Dict[str, Any]]] = None
    league_code = league.strip().upper() if league else None
    if league_code and league_code not in TOP5_CODES:
        raise HTTPException(400, f"Liga inválida: {league}. Válidas: {', '.join(TOP5_CODES)}")

    filters = []
    if top5 or league_code:
        league_map = team_league_map(db)
        allowed = [tid for tid, info in league_map.items() if not league_code or info["code"] == league_code]
        if team_id is not None:
            allowed = [team_id] if team_id in allowed else []
        if not allowed:
            return []
        filters.append(Player.team_id.in_(allowed))
    elif team_id:
        filters.append(Player.team_id == team_id)

    if q:
        pattern = f"%{q}%"
        filters.append(or_(Player.display_name.ilike(pattern), Player.last_name.ilike(pattern),
                           Player.first_name.ilike(pattern)))
    if position:
        filters.append(_position_clause(position))

    stmt = select(Player)
    if filters:
        stmt = stmt.where(and_(*filters))
    if order in _ORDERS:
        agg = order_subquery()
        stmt = (stmt.outerjoin(agg, agg.c.pid == Player.id)
                .order_by(desc(func.coalesce(getattr(agg.c, _ORDERS[order]), 0)), Player.last_name))
    else:
        stmt = stmt.order_by(Player.last_name)
    players = list(db.scalars(stmt.offset(skip).limit(limit)).all())

    # Batch load statistics — one query for the page instead of one per player.
    ids = [p.id for p in players]
    stats_by_player: Dict[int, list] = {}
    if ids:
        for s in db.scalars(select(PlayerStatistics).where(PlayerStatistics.player_id.in_(ids))).all():
            stats_by_player.setdefault(s.player_id, []).append(s)
    for p in players:
        p.statistics = stats_by_player.get(p.id, [])
    decorate_players(db, players, league_map)
    return players


@router.get("/players/{player_id}", response_model=PlayerDetailedOut)
def get_player(player_id: int, db: Session = Depends(get_db)):
    p = player_repo.get_detailed(db, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    decorate_players(db, [p])
    return p


@router.get("/players/{player_id}/overview")
def get_player_overview(player_id: int, db: Session = Depends(get_db)):
    """Dados do painel do jogador: forma recente, próximo jogo, médias da liga e extras do Understat.

    Tudo derivado de dados já coletados; blocos sem dados voltam vazios (``[]`` / ``null``).
    """
    p = player_repo.get(db, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    league_map = team_league_map(db)
    decorate_players(db, [p], league_map)
    stat = ps_repo.for_player(db, player_id)
    return {
        "player_id": p.id,
        "role": classify_role(p.position),
        "team": {
            "id": p.team_id,
            "name": getattr(p, "team_name", None),
            "short_name": getattr(p, "team_short_name", None),
            "logo_url": getattr(p, "team_logo_url", None),
        },
        "league": {"code": getattr(p, "league_code", None), "name": getattr(p, "league_name", None)},
        "extras": extras_from_stat(stat),
        "recent": recent_matches(db, p),
        "next_match": next_match(db, p),
        "league_average": None if (p.position and "GK" in p.position.upper())
        else league_averages(db, getattr(p, "league_code", None), league_map),
    }


@router.get("/players/{player_id}/index")
def get_player_index(player_id: int, db: Session = Depends(get_db)):
    """Índice por função: defensivo (defensores) ou de goleiro (goleiros), com componentes e KPIs.

    Para atacantes/meias devolve só ``role`` (``available=false``): o índice ofensivo é calculado na tela.
    """
    p = player_repo.get(db, player_id)
    if not p:
        raise HTTPException(404, "Player not found")
    return player_index_payload(db, p)


@router.get("/players/{player_id}/statistics", response_model=List[PlayerStatisticsOut])
def get_player_statistics(player_id: int, scope: str = "overall",
                          season_id: Optional[int] = None, db: Session = Depends(get_db)):
    s = ps_repo.for_player(db, player_id, scope=scope, season_id=season_id)
    if not s:
        return []
    return [s]


@router.get("/players/{player_id}/zones", response_model=List[PlayerZoneStatsOut])
def get_player_zones(player_id: int, season_id: Optional[int] = None,
                     db: Session = Depends(get_db)):
    zones = pzs_repo.for_player(db, player_id, season_id=season_id)
    if zones:
        return zones
    # Sem PlayerZoneStatistics (só existem em dados demo): deriva dos chutes reais do Understat.
    return derive_zone_stats(db, player_id)


def _dummy_match(db: Session, team_id: int) -> Optional[Match]:
    from app.repositories.repositories import MatchRepository
    from sqlalchemy import select, or_, and_
    mr = MatchRepository()
    # find any match team_id has played
    q = select(Match).where(or_(Match.home_team_id == team_id, Match.away_team_id == team_id)).limit(1)
    return db.scalar(q)


@router.get("/players/{player_id}/shot-probability", response_model=ProbabilityPrediction)
def get_shot_probability(player_id: int, opponent_team_id: int,
                         venue: str = Query("home", pattern="^(home|away)$"),
                         db: Session = Depends(get_db)):
    player = player_repo.get(db, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    if opponent_team_id and not player_repo.get(db, opponent_team_id):
        raise HTTPException(404, "Opponent team not found")
    # dummy match object - won't persist, just context
    from datetime import datetime
    from app.db.models import Match as MatchModel
    is_home = venue == "home"
    team_id = _guess_player_team(db, player_id)
    if not team_id:
        team_id = 1
    m = MatchModel(
        id=0,
        season_id=1,
        home_team_id=team_id if is_home else opponent_team_id,
        away_team_id=opponent_team_id if is_home else team_id,
        kickoff_time=datetime.utcnow(),
    )
    p = predict_for_player(db, player, m, "shot",
                           team_id=team_id, opponent_team_id=opponent_team_id,
                           is_home=is_home, include_zone_details=True)
    return ProbabilityPrediction(
        probability=p["probability"],
        baseline_probability=p["baseline_probability"],
        confidence=p["confidence"],
        positive_factors=p["positive_factors"],
        negative_factors=p["negative_factors"],
        model="scoutvision_baseline_shot",
        version="0.1.0",
    )


@router.get("/players/{player_id}/goal-probability", response_model=ProbabilityPrediction)
def get_goal_probability(player_id: int, opponent_team_id: int,
                         venue: str = Query("home", pattern="^(home|away)$"),
                         db: Session = Depends(get_db)):
    player = player_repo.get(db, player_id)
    if not player:
        raise HTTPException(404, "Player not found")
    from datetime import datetime
    from app.db.models import Match as MatchModel
    is_home = venue == "home"
    team_id = _guess_player_team(db, player_id) or 1
    m = MatchModel(
        id=0, season_id=1,
        home_team_id=team_id if is_home else opponent_team_id,
        away_team_id=opponent_team_id if is_home else team_id,
        kickoff_time=datetime.utcnow(),
    )
    p = predict_for_player(db, player, m, "goal",
                           team_id=team_id, opponent_team_id=opponent_team_id,
                           is_home=is_home, include_zone_details=True)
    return ProbabilityPrediction(
        probability=p["probability"],
        baseline_probability=p["baseline_probability"],
        confidence=p["confidence"],
        positive_factors=p["positive_factors"],
        negative_factors=p["negative_factors"],
        model="scoutvision_baseline_goal",
        version="0.1.0",
    )


def _guess_player_team(db, player_id: int) -> Optional[int]:
    from app.db.models import PlayerMatchStatistics
    from sqlalchemy import select, desc
    q = (select(PlayerMatchStatistics.team_id)
         .where(PlayerMatchStatistics.player_id == player_id)
         .order_by(desc(PlayerMatchStatistics.created_at)).limit(1))
    return db.scalar(q)
