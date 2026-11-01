"""Perfil de jogador: escopo das 5 grandes ligas, time atual, zonas e forma recente.

Tudo aqui é derivado de dados que já existem no banco (Understat + football-data):

* ``team_league_map``  → liga (PL, PD, BL1, SA, FL1) de cada time, a partir das
  estatísticas de time / partidas das temporadas dessas competições.
* ``decorate_players`` → anexa time atual e liga aos jogadores (campos opcionais do schema).
* ``derive_zone_stats`` → quando não há ``PlayerZoneStatistics`` (só existem em dados demo),
  calcula as zonas a partir dos chutes reais do Understat (posição X/Y + xG).
* ``recent_matches``   → últimos jogos do jogador (gols, assistências, chutes, xG) a partir
  dos eventos de chute/gol.
* ``next_match``       → próximo jogo agendado do time atual.
* ``league_averages``  → médias por 90 da liga (jogadores de linha, >= 450 min).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Competition, Event, EventPosition, EventType, Goal, Match, PitchZone, Player,
    PlayerStatistics, Season, Shot, Team, TeamStatistics,
)
from app.services.crests import resolve_crest
from app.services.scope import excluded_season_ids

# Códigos football-data das 5 ligas (mesmos de ``UNDERSTAT_LEAGUES`` e ``SYNC_COMPETITIONS``).
TOP5_CODES: tuple[str, ...] = ("PL", "PD", "BL1", "SA", "FL1")
LEAGUE_LABELS: Dict[str, str] = {
    "PL": "Premier League",
    "PD": "La Liga",
    "BL1": "Bundesliga",
    "SA": "Serie A",
    "FL1": "Ligue 1",
}


# --------------------------------------------------------------------------- ligas / times
def team_league_map(db: Session) -> Dict[int, Dict[str, Any]]:
    """``team_id -> {code, name, competition_id}`` só para times das 5 ligas.

    Fonte principal: ``TeamStatistics`` (é o que a tela de Times usa). Complemento: partidas
    das temporadas dessas competições, para times que ainda não têm estatística.
    Temporadas atuais / mais recentes sobrescrevem as antigas.
    """
    out: Dict[int, Dict[str, Any]] = {}

    stat_rows = db.execute(
        select(TeamStatistics.team_id, Competition.id, Competition.code, Season.id, Season.current)
        .join(Season, Season.id == TeamStatistics.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(Competition.code.in_(TOP5_CODES))
        .order_by(Season.current.asc(), Season.id.asc())
    ).all()
    for team_id, comp_id, code, _season_id, _current in stat_rows:
        out[team_id] = {"code": code, "name": LEAGUE_LABELS.get(code, code), "competition_id": comp_id}

    match_rows = db.execute(
        select(Match.home_team_id, Match.away_team_id, Competition.id, Competition.code)
        .join(Season, Season.id == Match.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(Competition.code.in_(TOP5_CODES))
    ).all()
    for home_id, away_id, comp_id, code in match_rows:
        for tid in (home_id, away_id):
            out.setdefault(tid, {"code": code, "name": LEAGUE_LABELS.get(code, code), "competition_id": comp_id})
    return out


def decorate_players(db: Session, players: Iterable[Player],
                     league_map: Optional[Dict[int, Dict[str, Any]]] = None) -> None:
    """Anexa ``team_name``, ``team_short_name``, ``team_logo_url``, ``league_code`` e ``league_name``."""
    players = list(players)
    team_ids = {p.team_id for p in players if p.team_id}
    if not team_ids:
        return
    teams = {t.id: t for t in db.scalars(select(Team).where(Team.id.in_(team_ids))).all()}
    if league_map is None:
        league_map = team_league_map(db)
    for p in players:
        t = teams.get(p.team_id) if p.team_id else None
        if t is None:
            continue
        p.team_name = t.name
        p.team_short_name = t.short_name or t.code
        p.team_logo_url = resolve_crest(t.name, t.logo_url)
        info = league_map.get(t.id)
        if info:
            p.league_code = info["code"]
            p.league_name = info["name"]


# --------------------------------------------------------------------------- zonas
# Retângulos das zonas em % do campo (x, y, w, h) — espelha ``frontend/src/lib/pitchZones.ts``.
_ZONE_RECTS: Dict[PitchZone, tuple[float, float, float, float]] = {
    PitchZone.OWN_BOX: (0, 21, 16, 58),
    PitchZone.OWN_LEFT_CHANNEL: (16, 18, 14, 20),
    PitchZone.OWN_RIGHT_CHANNEL: (16, 62, 14, 20),
    PitchZone.OWN_CENTRAL_MIDFIELD: (16, 38, 14, 24),
    PitchZone.OWN_LEFT_FLANK: (16, 0, 14, 18),
    PitchZone.OWN_RIGHT_FLANK: (16, 82, 14, 18),
    PitchZone.NEUTRAL_MIDFIELD: (30, 18, 40, 64),
    PitchZone.NEUTRAL_LEFT_FLANK: (30, 0, 40, 18),
    PitchZone.NEUTRAL_RIGHT_FLANK: (30, 82, 40, 18),
    PitchZone.OPP_LEFT_FLANK: (70, 0, 14, 18),
    PitchZone.OPP_RIGHT_FLANK: (70, 82, 14, 18),
    PitchZone.OPP_LEFT_CHANNEL: (70, 18, 14, 20),
    PitchZone.OPP_RIGHT_CHANNEL: (70, 62, 14, 20),
    PitchZone.OPP_CENTRAL_MIDFIELD: (70, 38, 14, 24),
    PitchZone.OUTSIDE_BOX_LEFT: (84, 21, 8, 19),
    PitchZone.OUTSIDE_BOX_RIGHT: (84, 60, 8, 19),
    PitchZone.OUTSIDE_BOX_CENTRAL: (84, 40, 8, 20),
    PitchZone.CENTRAL_BOX: (92, 29, 8, 42),
}


def zone_for_point(x: float, y: float) -> PitchZone:
    """Zona para um ponto (x, y) em % do campo; fora de qualquer retângulo usa o centro mais próximo."""
    for zone, (zx, zy, zw, zh) in _ZONE_RECTS.items():
        if zx <= x <= zx + zw and zy <= y <= zy + zh:
            return zone
    return min(
        _ZONE_RECTS,
        key=lambda z: (x - (_ZONE_RECTS[z][0] + _ZONE_RECTS[z][2] / 2)) ** 2
        + (y - (_ZONE_RECTS[z][1] + _ZONE_RECTS[z][3] / 2)) ** 2,
    )


def _latest_overall(db: Session, player_id: int) -> Optional[PlayerStatistics]:
    return db.scalar(
        select(PlayerStatistics)
        .where(PlayerStatistics.player_id == player_id, PlayerStatistics.scope == "overall")
        .order_by(PlayerStatistics.season_id.desc().nullslast())
    )


def derive_zone_stats(db: Session, player_id: int) -> List[Dict[str, Any]]:
    """Zonas de finalização do jogador a partir dos chutes reais (Understat).

    Sem toques/passes na fonte, ``touches`` repete a contagem de chutes. ``offensive_strength``
    é o xG da zona normalizado pelo maior xG de zona (0–1).
    """
    rows = db.execute(
        select(EventPosition.x, EventPosition.y, Shot.xg, Shot.is_goal)
        .select_from(Event)
        .join(EventPosition, EventPosition.event_id == Event.id)
        .join(Shot, Shot.event_id == Event.id)
        .where(Event.player_id == player_id, Event.type == EventType.SHOT)
    ).all()
    if not rows:
        return []

    stat = _latest_overall(db, player_id)
    minutes = (stat.minutes_played if stat and stat.minutes_played else 0) or 0

    acc: Dict[PitchZone, Dict[str, float]] = defaultdict(lambda: {"shots": 0, "goals": 0, "xg": 0.0})
    for x, y, xg, is_goal in rows:
        z = zone_for_point(float(x), float(y))
        acc[z]["shots"] += 1
        acc[z]["goals"] += 1 if is_goal else 0
        acc[z]["xg"] += float(xg or 0)

    total_shots = sum(v["shots"] for v in acc.values()) or 1
    max_xg = max((v["xg"] for v in acc.values()), default=0.0) or 1.0

    def per90(v: float) -> float:
        return round(v * 90 / minutes, 3) if minutes else 0.0

    out = [
        {
            "zone": zone,
            "touches": int(v["shots"]),
            "shots": int(v["shots"]),
            "goals": int(v["goals"]),
            "xg": round(v["xg"], 3),
            "touches_per_90": per90(v["shots"]),
            "shots_per_90": per90(v["shots"]),
            "xg_per_90": per90(v["xg"]),
            "zone_frequency_pct": round(v["shots"] / total_shots * 100, 1),
            "offensive_strength": round(v["xg"] / max_xg, 3),
        }
        for zone, v in acc.items()
    ]
    out.sort(key=lambda z: z["zone_frequency_pct"], reverse=True)
    return out


# --------------------------------------------------------------------------- forma recente
def recent_matches(db: Session, player: Player, limit: int = 8) -> List[Dict[str, Any]]:
    """Últimos jogos com atuação registrada (chutes/gols/assistências), do mais antigo ao mais novo."""
    shot_rows = db.execute(
        select(Event.match_id, Event.team_id, Shot.xg, Shot.is_goal)
        .select_from(Event)
        .join(Shot, Shot.event_id == Event.id)
        .where(Event.player_id == player.id, Event.type == EventType.SHOT)
    ).all()
    assist_rows = db.execute(
        select(Event.match_id, Event.team_id)
        .select_from(Goal)
        .join(Event, Event.id == Goal.event_id)
        .where(Goal.assist_player_id == player.id, Goal.is_own_goal.is_not(True))
    ).all()

    per_match: Dict[int, Dict[str, Any]] = {}

    def slot(match_id: int, team_id: Optional[int]) -> Dict[str, Any]:
        s = per_match.setdefault(
            match_id, {"match_id": match_id, "team_id": team_id, "goals": 0, "assists": 0, "shots": 0, "xg": 0.0}
        )
        if s["team_id"] is None:
            s["team_id"] = team_id
        return s

    for match_id, team_id, xg, is_goal in shot_rows:
        s = slot(match_id, team_id)
        s["shots"] += 1
        s["goals"] += 1 if is_goal else 0
        s["xg"] += float(xg or 0)
    for match_id, team_id in assist_rows:
        slot(match_id, team_id)["assists"] += 1

    if not per_match:
        return []

    matches = {
        m.id: m for m in db.scalars(select(Match).where(Match.id.in_(list(per_match)))).all()
    }
    team_ids = {m.home_team_id for m in matches.values()} | {m.away_team_id for m in matches.values()}
    names = {t.id: t.name for t in db.scalars(select(Team).where(Team.id.in_(team_ids))).all()} if team_ids else {}

    items: List[Dict[str, Any]] = []
    for mid, s in per_match.items():
        m = matches.get(mid)
        if m is None:
            continue
        own = s["team_id"] or player.team_id
        is_home = m.home_team_id == own
        opp_id = m.away_team_id if is_home else m.home_team_id
        result = None
        if m.home_score is not None and m.away_score is not None:
            mine, theirs = (m.home_score, m.away_score) if is_home else (m.away_score, m.home_score)
            result = "W" if mine > theirs else "D" if mine == theirs else "L"
        items.append({
            "match_id": mid,
            "date": m.kickoff_time.isoformat() if m.kickoff_time else None,
            "opponent": names.get(opp_id),
            "is_home": is_home,
            "result": result,
            "goals": s["goals"],
            "assists": s["assists"],
            "shots": s["shots"],
            "xg": round(s["xg"], 2),
        })
    items.sort(key=lambda i: i["date"] or "")
    return items[-limit:]


def next_match(db: Session, player: Player) -> Optional[Dict[str, Any]]:
    """Próximo jogo agendado do time atual do jogador (considera clones do mesmo clube por nome)."""
    if not player.team_id:
        return None
    team = db.get(Team, player.team_id)
    if team is None:
        return None
    same_club_ids = [player.team_id]
    same_club_ids += [
        tid for (tid,) in db.execute(select(Team.id).where(Team.name == team.name, Team.id != team.id)).all()
    ]
    now = datetime.utcnow()
    m = db.scalar(
        select(Match)
        .where(
            or_(Match.home_team_id.in_(same_club_ids), Match.away_team_id.in_(same_club_ids)),
            Match.kickoff_time >= now,
            Match.home_score.is_(None),
            Match.canonical_match_id.is_(None),
            Match.season_id.notin_(excluded_season_ids()),
        )
        .order_by(Match.kickoff_time)
        .limit(1)
    )
    if m is None:
        return None
    is_home = m.home_team_id in same_club_ids
    opp = db.get(Team, m.away_team_id if is_home else m.home_team_id)
    season = db.get(Season, m.season_id)
    comp = db.get(Competition, season.competition_id) if season else None
    return {
        "match_id": m.id,
        "kickoff_time": m.kickoff_time.isoformat() if m.kickoff_time else None,
        "is_home": is_home,
        "opponent_id": opp.id if opp else None,
        "opponent_name": opp.name if opp else None,
        "opponent_logo_url": resolve_crest(opp.name, opp.logo_url) if opp else None,
        "competition": LEAGUE_LABELS.get(comp.code, comp.name) if comp else None,
    }


# --------------------------------------------------------------------------- médias da liga
def _per90(total: float, minutes: float) -> float:
    return round(total * 90 / minutes, 3) if minutes else 0.0


def extras_from_stat(stat: Optional[PlayerStatistics]) -> Dict[str, float]:
    """Métricas extras do Understat guardadas em ``recent_form`` (npxG, xGChain, xGBuildup, cartões)."""
    rf = stat.recent_form if stat is not None and isinstance(stat.recent_form, dict) else {}
    minutes = float(stat.minutes_played or 0) if stat is not None else 0.0
    npxg = float(rf.get("npxg") or 0)
    chain = float(rf.get("xg_chain") or 0)
    buildup = float(rf.get("xg_buildup") or 0)
    return {
        "npxg_per_90": _per90(npxg, minutes),
        "xg_chain_per_90": _per90(chain, minutes),
        "xg_buildup_per_90": _per90(buildup, minutes),
        "npg": int(rf.get("npg") or 0),
        "yellow_cards": int(rf.get("yellow_cards") or 0),
        "red_cards": int(rf.get("red_cards") or 0),
    }


def league_averages(db: Session, league_code: Optional[str], league_map: Dict[int, Dict[str, Any]],
                    min_minutes: int = 450) -> Optional[Dict[str, Any]]:
    """Médias por 90 dos jogadores de linha da liga (ou das 5 ligas se a liga for desconhecida)."""
    team_ids = [tid for tid, info in league_map.items() if not league_code or info["code"] == league_code]
    if not team_ids:
        return None
    rows = db.execute(
        select(PlayerStatistics, Player.position)
        .join(Player, Player.id == PlayerStatistics.player_id)
        .where(
            Player.team_id.in_(team_ids),
            PlayerStatistics.scope == "overall",
            PlayerStatistics.minutes_played >= min_minutes,
        )
    ).all()
    keys = ["shots_per_90", "xg_per_90", "xa_per_90", "key_passes_per_90", "goals_per_90", "assists_per_90"]
    extra_keys = ["npxg_per_90", "xg_chain_per_90", "xg_buildup_per_90"]
    sums = {k: 0.0 for k in keys + extra_keys}
    n = 0
    for stat, position in rows:
        if position and "GK" in position.upper():
            continue
        n += 1
        for k in keys:
            sums[k] += float(getattr(stat, k) or 0)
        ex = extras_from_stat(stat)
        for k in extra_keys:
            sums[k] += ex[k]
    if n == 0:
        return None
    return {"n_players": n, "min_minutes": min_minutes, "league": league_code,
            **{k: round(v / n, 3) for k, v in sums.items()}}


def order_subquery():
    """Agregado por jogador para ordenar listas (maior valor entre temporadas)."""
    return (
        select(
            PlayerStatistics.player_id.label("pid"),
            func.max(PlayerStatistics.goals).label("goals"),
            func.max(PlayerStatistics.assists).label("assists"),
            func.max(PlayerStatistics.xg_total).label("xg"),
            func.max(PlayerStatistics.minutes_played).label("minutes"),
        )
        .where(PlayerStatistics.scope == "overall")
        .group_by(PlayerStatistics.player_id)
        .subquery()
    )


__all__ = [
    "TOP5_CODES", "LEAGUE_LABELS", "team_league_map", "decorate_players", "zone_for_point",
    "derive_zone_stats", "recent_matches", "next_match", "extras_from_stat", "league_averages",
    "order_subquery",
]
