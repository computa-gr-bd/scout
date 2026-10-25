"""Rotas da Understat — estatísticas de chutes (shots), xG, gols, times, tabela e eventos.

Endpoints:
- GET    /api/understat/leagues              — ligas disponíveis
- POST   /api/understat/sync                 — dispara sincronização (background)
- GET    /api/understat/matches              — partidas da Understat com filtro
- GET    /api/understat/matches/{id}/shots   — chutes de uma partida (com coordenadas e xG)
- GET    /api/understat/matches/{id}/events  — todos os eventos de uma partida (gols, chutes)
- POST   /api/understat/matches/{id}/shots   — força coleta de shots de uma partida
- GET    /api/understat/teams/{team_id}/stats — estatísticas de um time (temporada)
- GET    /api/understat/league-table/{league_key} — tabela da liga completa
- GET    /api/understat/players/{id}/shots   — chutes de um jogador
- GET    /api/understat/players/{id}/stats   — estatísticas agregadas de um jogador
- GET    /api/understat/stats                — estatísticas agregadas (top jogadores e times)
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from app.vendor.understat import Understat
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select, func, desc

from app.core.auth import require_admin
from app.db import get_db
from app.db.models import (
    CollectionState, Competition, DataSource, Event, EventPosition, EventType,
    Match, Player, Season, PlayerMatchStatistics, PlayerStatistics, Shot, Team,
    TeamMatchStatistics, TeamStatistics, User,
)
from app.services.understat_sync import (
    DEFAULT_SEASON, UNDERSTAT_LEAGUES, UnderstatClient, sync_understat_league,
)
from app.db import SessionLocal
from app.services.crests import resolve_crest

try:
    import aiohttp
except Exception:  # pragma: no cover
    aiohttp = None

router = APIRouter(tags=["understat"])


def _player_name(player: Player | None) -> str | None:
    if player is None:
        return None
    return player.display_name or " ".join(
        p for p in [player.first_name, player.last_name] if p
    )


def _run_async(coro):
    """Executa uma corrotina a partir de um contexto síncrono (FastAPI sync route)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    # Já existe um loop ativo (ex.: BackgroundTasks): roda em thread separada.
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def _league_from_comp(comp: Competition) -> Optional[str]:
    for key, info in UNDERSTAT_LEAGUES.items():
        if info["code"] == comp.code or info["name"].lower() == comp.name.lower():
            return key
    return None


@router.get("/understat/leagues")
def list_understat_leagues(db: Session = Depends(get_db)):
    """Lista as ligas europeias suportadas pela Understat e seu status no banco."""
    rows = []
    for key, info in UNDERSTAT_LEAGUES.items():
        comp = db.scalar(
            select(Competition).where(
                Competition.data_source == DataSource.UNDERSTAT,
                Competition.external_id == key,
            )
        )
        seasons = []
        if comp:
            seasons = [
                {"id": s.id, "name": s.name, "current": s.current}
                for s in db.scalars(
                    select(Season).where(Season.competition_id == comp.id)
                    .order_by(desc(Season.name))
                ).all()
            ]
        rows.append({
            "key": key,
            "name": info["name"],
            "code": info["code"],
            "country": info["country"],
            "synced": comp is not None,
            "competition_id": comp.id if comp else None,
            "seasons": seasons,
        })
    return {"leagues": rows, "default_season": DEFAULT_SEASON}


@router.get("/understat/sync/status")
def understat_sync_status(db: Session = Depends(get_db)):
    """Checkpoint de coleta Understat por liga (última execução e agregados)."""
    states = db.scalars(
        select(CollectionState)
        .where(CollectionState.provider == DataSource.UNDERSTAT.value)
        .order_by(CollectionState.resource)
    ).all()
    return {
        "provider": DataSource.UNDERSTAT.value,
        "leagues": [
            {
                "resource": s.resource,
                "status": s.status,
                "last_success_at": s.last_success_at.isoformat() if s.last_success_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "summary": s.summary,
            }
            for s in states
        ],
    }


@router.post("/understat/sync")
def sync_understat(
    background_tasks: BackgroundTasks,
    leagues: Optional[str] = Query(
        None, description="Ligas separadas por vírgula (ex.: epl,bundesliga). Padrão: todas."
    ),
    season: int = Query(DEFAULT_SEASON, description="Temporada (ano de início)."),
    shots_only: bool = Query(False, description="Apenas atualiza chutes de partidas já cadastradas."),
    max_matches: Optional[int] = Query(None, description="Limita o nº de partidas com chutes."),
    _admin: User = Depends(require_admin),
):
    """Dispara a sincronização da Understat em background (requer admin)."""
    if aiohttp is None:
        raise HTTPException(status_code=503, detail="aiohttp indisponível no servidor")

    league_list = [l.strip().lower() for l in leagues.split(",")] if leagues else list(UNDERSTAT_LEAGUES.keys())
    invalid = [l for l in league_list if l not in UNDERSTAT_LEAGUES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Ligas inválidas: {invalid}")

    def _run():
        async def _go():
            connector = aiohttp.TCPConnector(limit=5)
            async with aiohttp.ClientSession(connector=connector) as session:
                client = UnderstatClient(session)
                results = {}
                for league in league_list:
                    with SessionLocal() as db:
                        try:
                            counts = await sync_understat_league(
                                db, client, league, season,
                                shots_only=shots_only, max_matches=max_matches,
                            )
                            results[league] = counts
                        except Exception as exc:
                            results[league] = {"error": str(exc)}
                return results

        return _run_async(_go())

    background_tasks.add_task(_run)
    return {
        "status": "started",
        "leagues": league_list,
        "season": season,
        "shots_only": shots_only,
        "max_matches": max_matches,
    }


@router.get("/understat/matches")
def list_understat_matches(
    competition_id: Optional[int] = None,
    league_key: Optional[str] = Query(None, description="Chave da liga (ex.: epl)."),
    season_id: Optional[int] = None,
    team_id: Optional[int] = None,
    finished_only: bool = Query(True),
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """Lista partidas sincronizadas via Understat."""
    q = select(Match).options(
        selectinload(Match.home_team), selectinload(Match.away_team)
    ).where(Match.data_source == DataSource.UNDERSTAT)

    if league_key:
        comp = db.scalar(
            select(Competition).where(
                Competition.data_source == DataSource.UNDERSTAT,
                Competition.external_id == league_key,
            )
        )
        if comp is None:
            return []
        competition_id = comp.id

    if season_id:
        q = q.where(Match.season_id == season_id)
    elif competition_id:
        sub = select(Season.id).where(Season.competition_id == competition_id)
        q = q.where(Match.season_id.in_(sub))

    if team_id:
        from sqlalchemy import or_
        q = q.where(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))

    if finished_only:
        q = q.where(Match.status == "finished")

    q = q.order_by(desc(Match.kickoff_time)).offset(skip).limit(limit)
    matches = db.scalars(q).all()

    out = []
    for m in matches:
        out.append({
            "id": m.id,
            "external_id": m.external_id,
            "competition": (m.season.competition.name if m.season and m.season.competition else None),
            "season": (m.season.name if m.season else None),
            "season_id": m.season_id,
            "home_team": {"id": m.home_team.id, "name": m.home_team.name, "logo_url": resolve_crest(m.home_team.name, m.home_team.logo_url)} if m.home_team else None,
            "away_team": {"id": m.away_team.id, "name": m.away_team.name, "logo_url": resolve_crest(m.away_team.name, m.away_team.logo_url)} if m.away_team else None,
            "home_score": m.home_score,
            "away_score": m.away_score,
            "status": m.status,
            "kickoff_time": m.kickoff_time.isoformat() if m.kickoff_time else None,
            "has_shots": bool(m.events and any(e.type == EventType.SHOT for e in m.events)),
        })
    return out


@router.get("/understat/matches/{match_id}/shots")
def get_match_shots(
    match_id: int,
    db: Session = Depends(get_db),
):
    """Retorna todos os chutes (shots) de uma partida com coordenadas (x, y) e xG."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.data_source != DataSource.UNDERSTAT:
        raise HTTPException(status_code=400, detail="Match não é da Understat")

    shots = []
    for e in m.events:
        if e.type != EventType.SHOT:
            continue
        shot = e.shot
        pos = e.position
        shots.append({
            "event_id": e.id,
            "minute": e.minute,
            "period": e.period,
            "player": _player_name(e.player),
            "team": e.team.name if e.team else None,
            "result": e.outcome,
            "on_target": shot.on_target if shot else None,
            "is_goal": shot.is_goal if shot else None,
            "xg": shot.xg if shot else None,
            "x": pos.x if pos else None,
            "y": pos.y if pos else None,
            "end_x": pos.end_x if pos else None,
            "end_y": pos.end_y if pos else None,
            "situation": shot.situation if shot else None,
            "body_part": shot.body_part if shot else None,
            "shot_type": shot.shot_type if shot else None,
            "last_action": (e.details or {}).get("last_action"),
            "assisted_by": (e.details or {}).get("assisted_by"),
            "details": e.details,
        })

    home_shots = [s for s in shots if s["team"] == (m.home_team.name if m.home_team else None)]
    away_shots = [s for s in shots if s["team"] == (m.away_team.name if m.away_team else None)]

    return {
        "match_id": m.id,
        "external_id": m.external_id,
        "home_team": {"id": m.home_team.id, "name": m.home_team.name} if m.home_team else None,
        "away_team": {"id": m.away_team.id, "name": m.away_team.name} if m.away_team else None,
        "home_score": m.home_score,
        "away_score": m.away_score,
        "summary": {
            "home_shots": len(home_shots),
            "home_shots_on_target": sum(1 for s in home_shots if s["on_target"]),
            "home_xg": round(sum(s["xg"] or 0 for s in home_shots), 2),
            "away_shots": len(away_shots),
            "away_shots_on_target": sum(1 for s in away_shots if s["on_target"]),
            "away_xg": round(sum(s["xg"] or 0 for s in away_shots), 2),
        },
        "shots": shots,
    }


@router.post("/understat/matches/{match_id}/shots")
def force_match_shots(
    match_id: int,
    understat_match_id: str = Query(..., description="ID da partida na Understat"),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Força a coleta de chutes de uma partida específica da Understat (requer admin)."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.home_team is None or m.away_team is None:
        raise HTTPException(status_code=400, detail="Partida sem times associados")

    if m.external_id != understat_match_id:
        existing = db.scalar(
            select(Match).where(
                Match.data_source == DataSource.UNDERSTAT,
                Match.external_id == understat_match_id,
                Match.id != match_id,
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail="understat_match_id já usado por outra partida")
        m.external_id = understat_match_id
        db.flush()

    async def _go():
        connector = aiohttp.TCPConnector(limit=1)
        async with aiohttp.ClientSession(connector=connector) as session:
            client = UnderstatClient(session)
            return await client.match_shots(understat_match_id)

    try:
        shots_by_side = _run_async(_go())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao consultar Understat: {exc}")

    if not isinstance(shots_by_side, dict):
        raise HTTPException(status_code=502, detail="Resposta inesperada da Understat")

    from app.services.understat_sync import (
        BODY_PART_MAP, SHOT_RESULT_GOAL, SHOT_RESULT_ON_TARGET, UnderstatMapper,
    )
    mapper = UnderstatMapper(db, m.season_id)
    for team in (m.home_team, m.away_team):
        mapper.get_or_create_team(team.external_id or f"local:{team.id}", team.name, team.short_name)

    counts = {"shots": 0, "events": 0, "skipped": 0}
    for side in ("h", "a"):
        team = m.home_team if side == "h" else m.away_team
        for s in shots_by_side.get(side) or []:
            side_team = m.home_team if (s.get("h_a") or side) == "h" else m.away_team
            team = side_team or team
            shot_id = s.get("id")
            x, y = s.get("X"), s.get("Y")
            if x is None or y is None or shot_id is None:
                counts["skipped"] += 1
                continue

            external_id = f"us-shot-{understat_match_id}-{shot_id}"
            if db.scalar(select(Event.id).where(
                Event.data_source == DataSource.UNDERSTAT, Event.external_id == external_id
            )):
                counts["skipped"] += 1
                continue

            minute = int(s.get("minute") or 0)
            player = None
            pid = s.get("player_id")
            if pid is not None and str(pid) != "0":
                player = mapper.get_or_create_player(str(pid), s.get("player"), team)

            event = Event(
                external_id=external_id,
                match_id=m.id,
                team_id=team.id,
                player_id=player.id if player else None,
                type=EventType.SHOT,
                minute=minute,
                period="1H" if minute <= 45 else ("2H" if minute <= 90 else "ET"),
                outcome=s.get("result"),
                details={
                    "understat_shot_id": str(shot_id),
                    "situation": s.get("situation"),
                    "shot_type": s.get("shotType"),
                },
                data_source=DataSource.UNDERSTAT,
            )
            db.add(event)
            db.flush()
            counts["events"] += 1

            db.add(EventPosition(event_id=event.id, x=float(x) * 100.0, y=float(y) * 100.0))
            db.add(Shot(
                event_id=event.id,
                on_target=s.get("result") in SHOT_RESULT_ON_TARGET,
                is_goal=s.get("result") == SHOT_RESULT_GOAL,
                body_part=BODY_PART_MAP.get(s.get("shotType")),
                situation=s.get("situation"),
                shot_type=s.get("shotType"),
                xg=float(s.get("xG") or 0),
            ))
            db.flush()
            counts["shots"] += 1

    db.commit()
    return {"match_id": match_id, "understat_match_id": understat_match_id, **counts}


@router.get("/understat/players/{player_id}/shots")
def get_player_shots(
    player_id: int,
    db: Session = Depends(get_db),
):
    """Retorna todos os chutes de um jogador."""
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    events = db.scalars(
        select(Event)
        .options(selectinload(Event.shot), selectinload(Event.position), selectinload(Event.team))
        .where(Event.player_id == player_id, Event.type == EventType.SHOT)
        .order_by(Event.match_id, Event.minute)
    ).all()

    pname = _player_name(player)
    shots = []
    for e in events:
        shot = e.shot
        pos = e.position
        shots.append({
            "event_id": e.id,
            "match_id": e.match_id,
            "minute": e.minute,
            "period": e.period,
            "player": pname,
            "team": e.team.name if e.team else None,
            "result": e.outcome,
            "on_target": shot.on_target if shot else None,
            "is_goal": shot.is_goal if shot else None,
            "xg": shot.xg if shot else None,
            "x": pos.x if pos else None,
            "y": pos.y if pos else None,
            "end_x": pos.end_x if pos else None,
            "end_y": pos.end_y if pos else None,
            "situation": shot.situation if shot else None,
            "body_part": shot.body_part if shot else None,
        })
    return {"player_id": player_id, "player": _player_name(player), "shots": shots}


@router.get("/understat/players/{player_id}/stats")
def get_player_stats(
    player_id: int,
    db: Session = Depends(get_db),
):
    """Estatísticas agregadas de um jogador (gols, chutes, xG, cartões)."""
    player = db.get(Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    stats = db.scalars(
        select(PlayerStatistics).where(PlayerStatistics.player_id == player_id)
    ).all()

    yellow = 0
    red = 0
    for st in stats:
        rf = st.recent_form or {}
        yellow += int(rf.get("yellow_cards", 0) or 0)
        red += int(rf.get("red_cards", 0) or 0)

    total_shots = sum(st.shots or 0 for st in stats)
    total_goals = sum(st.goals or 0 for st in stats)
    total_xg = round(sum(st.xg_total or 0 for st in stats), 2)

    return {
        "player_id": player.id,
        "player": _player_name(player),
        "team": player.team.name if player.team else None,
        "yellow_cards": yellow,
        "red_cards": red,
        "total_shots": total_shots,
        "total_goals": total_goals,
        "total_xg": total_xg,
        "seasons": [
            {
                "season_id": st.season_id,
                "matches_played": st.matches_played,
                "minutes_played": st.minutes_played,
                "goals": st.goals,
                "assists": st.assists,
                "shots": st.shots,
                "shots_on_target": st.shots_on_target,
                "xg": st.xg_total,
                "xa": st.xa_total,
                "xg_per_90": st.xg_per_90,
                "shots_per_90": st.shots_per_90,
            }
            for st in stats
        ],
    }


@router.get("/understat/stats")
def understat_stats(
    competition_id: Optional[int] = None,
    season_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Estatísticas agregadas da Understat, filtráveis por competição e temporada.

    Mantém os rankings (`top_*`) e devolve também `players` e `teams` completos
    (gols, xG, chutes, PPDA, deep, xpts...) para gráficos de desempenho vs. esperado.
    """
    season_ids: list[int] | None = None
    if season_id:
        season_ids = [season_id]
    elif competition_id:
        season_ids = list(db.scalars(select(Season.id).where(Season.competition_id == competition_id)).all())

    pq = (
        select(PlayerStatistics, Player)
        .join(Player, Player.id == PlayerStatistics.player_id)
        .where(Player.data_source == DataSource.UNDERSTAT)
    )
    if season_ids is not None:
        pq = pq.where(PlayerStatistics.season_id.in_(season_ids))

    agg: dict[int, dict[str, Any]] = {}
    for st, pl in db.execute(pq).all():
        row = agg.setdefault(pl.id, {
            "player_id": pl.id,
            "player": _player_name(pl),
            "team": pl.team.name if pl.team else None,
            "matches_played": 0, "minutes": 0, "goals": 0, "assists": 0,
            "shots": 0, "shots_on_target": 0, "xg": 0.0, "xa": 0.0,
        })
        row["matches_played"] += st.matches_played or 0
        row["minutes"] += st.minutes_played or 0
        row["goals"] += st.goals or 0
        row["assists"] += st.assists or 0
        row["shots"] += st.shots or 0
        row["shots_on_target"] += st.shots_on_target or 0
        row["xg"] += st.xg_total or 0.0
        row["xa"] += st.xa_total or 0.0

    players = []
    for r in agg.values():
        r["xg"] = round(r["xg"], 2)
        r["xa"] = round(r["xa"], 2)
        r["xg_diff"] = round(r["goals"] - r["xg"], 2)
        r["xg_per_shot"] = round(r["xg"] / r["shots"], 3) if r["shots"] else None
        players.append(r)
    players.sort(key=lambda r: (r["xg"], r["goals"]), reverse=True)

    tq = (
        select(TeamStatistics, Team)
        .join(Team, Team.id == TeamStatistics.team_id)
        .where(Team.data_source == DataSource.UNDERSTAT)
    )
    if season_ids is not None:
        tq = tq.where(TeamStatistics.season_id.in_(season_ids))
    teams = []
    for st, t in db.execute(tq).all():
        rf = st.recent_form or {}
        teams.append({
            "team_id": t.id,
            "team": t.name,
            "logo_url": resolve_crest(t.name, t.logo_url),
            "matches_played": st.matches_played,
            "wins": st.wins, "draws": st.draws, "losses": st.losses,
            "goals_for": st.goals_for, "goals_against": st.goals_against,
            "xg": st.xg_total, "xga": st.xga_total,
            "points_per_game": st.points_per_game,
            "ppda": rf.get("ppda"), "deep": rf.get("deep"), "xpts": rf.get("xpts"),
            "points": rf.get("points"),
        })
    teams.sort(key=lambda r: r["points_per_game"] or 0, reverse=True)

    def top(key: str, n: int = 10):
        return sorted(players, key=lambda r: r[key], reverse=True)[:n]

    return {
        "top_scorers": [{"player_id": r["player_id"], "player": r["player"], "team": r["team"], "goals": r["goals"]} for r in top("goals")],
        "top_xg": [{"player_id": r["player_id"], "player": r["player"], "team": r["team"], "xg": r["xg"]} for r in top("xg")],
        "top_shots": [{"player_id": r["player_id"], "player": r["player"], "team": r["team"], "shots": r["shots"]} for r in top("shots")],
        "top_teams": teams[:10],
        "players": players[:150],
        "teams": teams,
    }


@router.get("/understat/teams/{team_id}/form")
def get_team_form(
    team_id: int,
    limit: int = Query(5, ge=1, le=15),
    season_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Forma recente: xG a favor/contra, chutes e resultado dos últimos jogos do time."""
    from sqlalchemy import or_

    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    q = select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team)).where(
        Match.data_source == DataSource.UNDERSTAT,
        Match.status == "finished",
        or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
    )
    if season_id:
        q = q.where(Match.season_id == season_id)
    matches = db.scalars(q.order_by(desc(Match.kickoff_time)).limit(limit)).all()
    ids = [m.id for m in matches]

    xg_by: dict[tuple[int, int], dict[str, float]] = {}
    if ids:
        rows = db.execute(
            select(
                Event.match_id, Event.team_id,
                func.coalesce(func.sum(Shot.xg), 0.0), func.count(Shot.id),
            )
            .join(Shot, Shot.event_id == Event.id)
            .where(Event.match_id.in_(ids), Event.type == EventType.SHOT)
            .group_by(Event.match_id, Event.team_id)
        ).all()
        for mid, tid, xg, n in rows:
            xg_by[(mid, tid)] = {"xg": float(xg or 0), "shots": int(n or 0)}

    out = []
    for m in matches:
        home = m.home_team_id == team_id
        opp = m.away_team if home else m.home_team
        opp_id = m.away_team_id if home else m.home_team_id
        gf = m.home_score if home else m.away_score
        ga = m.away_score if home else m.home_score
        mine = xg_by.get((m.id, team_id), {"xg": 0.0, "shots": 0})
        theirs = xg_by.get((m.id, opp_id), {"xg": 0.0, "shots": 0})
        result = None
        if gf is not None and ga is not None:
            result = "W" if gf > ga else "D" if gf == ga else "L"
        out.append({
            "match_id": m.id,
            "kickoff_time": m.kickoff_time.isoformat() if m.kickoff_time else None,
            "home": home,
            "opponent": opp.name if opp else None,
            "goals_for": gf, "goals_against": ga, "result": result,
            "xg_for": round(mine["xg"], 2), "xg_against": round(theirs["xg"], 2),
            "shots_for": mine["shots"], "shots_against": theirs["shots"],
            "has_shots": bool(mine["shots"] or theirs["shots"]),
        })
    out.reverse()  # cronológico: mais antigo -> mais recente
    return {"team_id": team_id, "team": team.name, "matches": out}


@router.get("/understat/teams/{team_id}/shots")
def get_team_shots(
    team_id: int,
    limit: int = Query(5, ge=1, le=15),
    season_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Chutes do próprio time nas últimas N partidas finalizadas (usado para comparar times).

    As coordenadas vêm no padrão Understat (ataque sempre para x = 100); o espelhamento
    por lado do campo é feito no frontend.
    """
    from sqlalchemy import or_

    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    q = select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team)).where(
        Match.data_source == DataSource.UNDERSTAT,
        Match.status == "finished",
        or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
    )
    if season_id:
        q = q.where(Match.season_id == season_id)
    matches = db.scalars(q.order_by(desc(Match.kickoff_time)).limit(limit)).all()
    ids = [m.id for m in matches]

    info: dict[int, dict[str, Any]] = {}
    for m in matches:
        home = m.home_team_id == team_id
        opp = m.away_team if home else m.home_team
        gf = m.home_score if home else m.away_score
        ga = m.away_score if home else m.home_score
        result = None
        if gf is not None and ga is not None:
            result = "W" if gf > ga else "D" if gf == ga else "L"
        info[m.id] = {
            "match_id": m.id,
            "kickoff_time": m.kickoff_time.isoformat() if m.kickoff_time else None,
            "home": home,
            "opponent": opp.name if opp else None,
            "goals_for": gf, "goals_against": ga, "result": result,
        }

    shots: list[dict[str, Any]] = []
    if ids:
        events = db.scalars(
            select(Event)
            .options(selectinload(Event.shot), selectinload(Event.position), selectinload(Event.player))
            .where(Event.match_id.in_(ids), Event.team_id == team_id, Event.type == EventType.SHOT)
        ).all()
        for e in events:
            sh, pos = e.shot, e.position
            shots.append({
                "event_id": e.id,
                "match_id": e.match_id,
                "minute": e.minute,
                "period": e.period,
                "player": _player_name(e.player),
                "team": team.name,
                "result": e.outcome,
                "on_target": sh.on_target if sh else None,
                "is_goal": sh.is_goal if sh else None,
                "xg": sh.xg if sh else None,
                "x": pos.x if pos else None,
                "y": pos.y if pos else None,
                "end_x": pos.end_x if pos else None,
                "end_y": pos.end_y if pos else None,
                "situation": sh.situation if sh else None,
                "body_part": sh.body_part if sh else None,
                "shot_type": sh.shot_type if sh else None,
                "last_action": (e.details or {}).get("last_action"),
                "assisted_by": (e.details or {}).get("assisted_by"),
            })
        shots.sort(key=lambda s: (s["match_id"], s["minute"] or 0))

    ordered = [info[m.id] for m in reversed(matches)]  # cronológico: mais antigo -> mais recente
    for row in ordered:
        row["shots_count"] = sum(1 for s in shots if s["match_id"] == row["match_id"])
    return {
        "team_id": team_id,
        "team": team.name,
        "logo_url": resolve_crest(team.name, team.logo_url),
        "matches": ordered,
        "shots": shots,
    }


@router.get("/understat/matches/{match_id}/events")
def get_match_events(
    match_id: int,
    db: Session = Depends(get_db),
):
    """Retorna todos os eventos de uma partida (gols e chutes com coordenadas/xG)."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if m.data_source != DataSource.UNDERSTAT:
        raise HTTPException(status_code=400, detail="Match não é da Understat")

    events = []
    for e in m.events:
        if e.type not in (EventType.SHOT, EventType.GOAL):
            continue
        shot = e.shot
        pos = e.position
        events.append({
            "event_id": e.id,
            "type": e.type,
            "minute": e.minute,
            "period": e.period,
            "player": _player_name(e.player),
            "team": e.team.name if e.team else None,
            "result": e.outcome,
            "on_target": shot.on_target if shot else None,
            "is_goal": shot.is_goal if shot else None,
            "xg": shot.xg if shot else None,
            "x": pos.x if pos else None,
            "y": pos.y if pos else None,
            "end_x": pos.end_x if pos else None,
            "end_y": pos.end_y if pos else None,
            "situation": shot.situation if shot else None,
            "is_penalty": (e.goal.is_penalty if e.goal else None),
            "is_own_goal": (e.goal.is_own_goal if e.goal else None),
            "assist_player": (
                _player_name(e.goal.assist)
                if e.goal and e.goal.assist else None
            ),
        })

    events.sort(key=lambda x: x["minute"])

    home_events = [e for e in events if e["team"] == (m.home_team.name if m.home_team else None)]
    away_events = [e for e in events if e["team"] == (m.away_team.name if m.away_team else None)]

    return {
        "match_id": m.id,
        "external_id": m.external_id,
        "home_team": {"id": m.home_team.id, "name": m.home_team.name} if m.home_team else None,
        "away_team": {"id": m.away_team.id, "name": m.away_team.name} if m.away_team else None,
        "home_score": m.home_score,
        "away_score": m.away_score,
        "status": m.status,
        "events": events,
        "home_events": home_events,
        "away_events": away_events,
        "goals": [e for e in events if e["is_goal"]],
    }


@router.get("/understat/teams/{team_id}/stats")
def get_team_stats(
    team_id: int,
    db: Session = Depends(get_db),
):
    """Estatísticas agregadas de um time (temporada)."""
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.data_source != DataSource.UNDERSTAT:
        raise HTTPException(status_code=400, detail="Team não é da Understat")

    stats = db.scalars(
        select(TeamStatistics).where(TeamStatistics.team_id == team_id)
    ).all()

    if not stats:
        return {
            "team_id": team.id,
            "team": team.name,
            "seasons": [],
        }

    total_matches = sum(st.matches_played or 0 for st in stats)
    total_wins = sum(st.wins or 0 for st in stats)
    total_draws = sum(st.draws or 0 for st in stats)
    total_losses = sum(st.losses or 0 for st in stats)
    total_goals_for = sum(st.goals_for or 0 for st in stats)
    total_goals_against = sum(st.goals_against or 0 for st in stats)
    total_shots = sum(st.shots or 0 for st in stats)
    total_shots_on_target = sum(st.shots_on_target or 0 for st in stats)
    total_xg = sum(st.xg_total or 0 for st in stats)
    total_xga = sum(st.xga_total or 0 for st in stats)
    total_corners = sum(st.corners_total or 0 for st in stats)

    return {
        "team_id": team.id,
        "team": team.name,
        "short_name": team.short_name,
        "logo_url": resolve_crest(team.name, team.logo_url),
        "total_matches_played": total_matches,
        "total_wins": total_wins,
        "total_draws": total_draws,
        "total_losses": total_losses,
        "total_goals_for": total_goals_for,
        "total_goals_against": total_goals_against,
        "total_shots": total_shots,
        "total_shots_on_target": total_shots_on_target,
        "total_xg": round(total_xg, 2),
        "total_xga": round(total_xga, 2),
        "total_corners": total_corners,
        "goal_difference": total_goals_for - total_goals_against,
        "win_pct": round(total_wins / total_matches * 100, 2) if total_matches else 0.0,
        "seasons": [
            {
                "season_id": st.season_id,
                "scope": st.scope,
                "matches_played": st.matches_played,
                "wins": st.wins,
                "draws": st.draws,
                "losses": st.losses,
                "goals_for": st.goals_for,
                "goals_against": st.goals_against,
                "goal_difference": (st.goals_for or 0) - (st.goals_against or 0),
                "shots": st.shots,
                "shots_on_target": st.shots_on_target,
                "xg": st.xg_total,
                "xga": st.xga_total,
                "corners": st.corners_total,
                "shots_per_90": st.shots_per_90,
                "xg_per_90": st.xg_per_90,
                "xga_per_90": st.xga_per_90,
                "points_per_game": st.points_per_game,
                "recent_form": st.recent_form,
            }
            for st in stats
        ],
    }


@router.get("/understat/league-table/{league_key}")
def get_league_table(
    league_key: str,
    season_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Tabela da liga com estatísticas da Understat (times da temporada)."""
    comp = db.scalar(
        select(Competition).where(
            Competition.data_source == DataSource.UNDERSTAT,
            Competition.external_id == league_key,
        )
    )
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found for understat")

    if season_id:
        season = db.get(Season, season_id)
        if season is None or season.competition_id != comp.id:
            raise HTTPException(status_code=404, detail="Season not found for this league")
    else:
        season = db.scalars(
            select(Season).where(Season.competition_id == comp.id).order_by(desc(Season.name))
        ).first()

    if season is None:
        return {"league": comp.name, "league_key": league_key, "season": None, "table": []}

    teams_stats = db.execute(
        select(TeamStatistics, Team)
        .join(Team, Team.id == TeamStatistics.team_id)
        .where(TeamStatistics.season_id == season.id)
        .order_by(desc(TeamStatistics.points_per_game or 0), desc(TeamStatistics.goals_for or 0))
    ).all()

    from app.services.crests import resolve_crest
    table = []
    for pos, (st, team) in enumerate(teams_stats, start=1):
        rf = st.recent_form or {}
        table.append({
            "position": pos,
            "team_id": team.id,
            "team": team.name,
            "short_name": team.short_name,
            "logo_url": resolve_crest(team.name, team.logo_url),
            "matches_played": st.matches_played,
            "wins": st.wins,
            "draws": st.draws,
            "losses": st.losses,
            "goals_for": st.goals_for,
            "goals_against": st.goals_against,
            "goal_difference": (st.goals_for or 0) - (st.goals_against or 0),
            "points": (st.wins or 0) * 3 + (st.draws or 0),
            "points_per_game": st.points_per_game,
            "xg": st.xg_total,
            "xga": st.xga_total,
            "shots": st.shots,
            "shots_on_target": st.shots_on_target,
            "corners": st.corners_total,
            "recent_form": rf,
            "season_id": season.id,
            "season_name": season.name,
        })

    return {
        "league": comp.name,
        "league_key": league_key,
        "season": season.name,
        "season_id": season.id,
        "table": table,
    }