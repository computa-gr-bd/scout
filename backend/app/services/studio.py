"""Dados reais para o ScoutVision Studio (tela de Análise).

Monta, para uma partida, tudo o que o Studio desenha — chutes com coordenadas
e xG, mapa de calor, escalação e fichas de jogador — **somente a partir do que
existe no banco** (Understat, StatsBomb, football-data). Nada é inventado:
quando a fonte não traz um dado, o campo vem ``None`` e a tela mostra "—".

Modos devolvidos em ``mode``:

* ``match``        — a própria partida (ou a "gêmea" em outra fonte) tem chutes.
* ``recent_form``  — partida FUTURA (ainda sem eventos): agrega os chutes dos
                     últimos jogos de cada time (pré-jogo). Nunca é usado para
                     partida já finalizada: lá seria misturar outros jogos.
* ``none``         — sem chutes: nenhuma fonte tem dados para esses times, ou a
                     partida já terminou e a fonte ainda não publicou os chutes.

Convenção de coordenadas devolvida (já pronta para o campo do Studio):
x/y em 0..100, mandante ataca para a direita (gol em x=100) e visitante ataca
para a esquerda (gol em x=0). As fontes entregam coordenadas "ataque para a
direita" para os dois times, então o visitante é girado 180°.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    Event, EventType, Lineup, Match, Player, PlayerMatchStatistics,
    PlayerStatistics, Team,
)
from app.services.crests import resolve_crest
from app.services.lineups import FORMATION, _place, estimated_lineup, official_lineups

RECENT_MATCHES = 5
HEAT_COLS, HEAT_ROWS = 10, 8

_STOP_TOKENS = {
    "fc", "cf", "afc", "sc", "ec", "ac", "as", "ss", "rc", "cd", "ud", "sd",
    "fk", "sk", "bk", "calcio", "club", "de", "da", "do", "the", "1",
}
_LINE_LABEL = {"GK": "GOL", "DEF": "DEF", "MID": "MEI", "ATT": "ATA"}


# --------------------------------------------------------------------------
# Normalização de nomes (vincula fontes diferentes: football-data ↔ Understat)
# --------------------------------------------------------------------------
def _ascii(text: Optional[str]) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


# Grafias diferentes entre football-data e Understat para o mesmo clube.
_TOKEN_ALIAS = {
    "munchen": "munich", "koln": "cologne", "internazionale": "inter",
    "saint": "st", "wanderers": "", "hotspur": "", "albion": "",
}


def norm_team(name: Optional[str]) -> str:
    tokens = [_TOKEN_ALIAS.get(t, t) for t in re.split(r"[^a-z0-9]+", _ascii(name))]
    return " ".join(t for t in tokens if t and t not in _STOP_TOKENS)


def norm_person(name: Optional[str]) -> str:
    return " ".join(t for t in re.split(r"[^a-z0-9]+", _ascii(name)) if t)


def _same_team_name(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 4 and short in long_


def _same_person(a: str, b: str) -> bool:
    """Mesmo jogador entre fontes: nome igual, ou mesmo sobrenome + mesma inicial."""
    if not a or not b:
        return False
    if a == b:
        return True
    ta, tb = a.split(), b.split()
    return len(ta) > 0 and len(tb) > 0 and ta[-1] == tb[-1] and ta[0][0] == tb[0][0]


def _team_ids_like(db: Session, team: Optional[Team]) -> List[int]:
    """Ids do time + equivalentes de outras fontes (mesmo nome normalizado)."""
    if team is None:
        return []
    key = norm_team(team.name)
    ids = {team.id}
    for other in db.scalars(select(Team)).all():
        if other.id != team.id and _same_team_name(key, norm_team(other.name)):
            ids.add(other.id)
    return sorted(ids)


# --------------------------------------------------------------------------
# Chutes
# --------------------------------------------------------------------------
def _player_name(p: Optional[Player]) -> Optional[str]:
    if p is None:
        return None
    return p.display_name or " ".join(x for x in [p.first_name, p.last_name] if x) or None


def _result_of(e: Event) -> str:
    shot = e.shot
    outcome = (e.outcome or "").lower().replace(" ", "")
    if (shot and shot.is_goal) or outcome == "goal":
        return "goal"
    if "block" in outcome:
        return "blocked"
    if "save" in outcome or "post" in outcome:
        return "saved"
    if outcome:
        if shot and shot.on_target:
            return "saved"
        return "off_target"
    return "saved" if (shot and shot.on_target) else "off_target"


def _flip(x: float, y: float, away: bool) -> Tuple[float, float]:
    x = max(0.0, min(100.0, x))
    y = max(0.0, min(100.0, y))
    return (round(100 - x, 1), round(100 - y, 1)) if away else (round(x, 1), round(y, 1))


def _load_shot_events(db: Session, match_ids: Iterable[int]) -> List[Event]:
    ids = list(match_ids)
    if not ids:
        return []
    q = (
        select(Event)
        .options(selectinload(Event.position), selectinload(Event.shot), selectinload(Event.player))
        .where(Event.match_id.in_(ids), Event.type == EventType.SHOT)
        .order_by(Event.match_id, Event.minute)
    )
    return [e for e in db.scalars(q).all() if e.position is not None]


def _serialize_shots(events: List[Event], home_team_ids: set, source_match: Dict[int, Match]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for e in events:
        shot, pos = e.shot, e.position
        away = e.team_id not in home_team_ids
        x, y = _flip(pos.x, pos.y, away)
        has_end = pos.end_x is not None and pos.end_y is not None
        if has_end:
            ex, ey = _flip(pos.end_x, pos.end_y, away)
        else:
            ex, ey = (0.0 if away else 100.0), 50.0
        details = e.details or {}
        sm = source_match.get(e.match_id)
        out.append({
            "id": e.id,
            "match_id": e.match_id,
            "match_label": (
                f"{sm.home_team.name if sm and sm.home_team else '?'} "
                f"{sm.home_score if sm and sm.home_score is not None else ''}–"
                f"{sm.away_score if sm and sm.away_score is not None else ''} "
                f"{sm.away_team.name if sm and sm.away_team else '?'}"
            ) if sm else None,
            "minute": e.minute,
            "team": "away" if away else "home",
            "player_id": e.player_id,
            "player": _player_name(e.player),
            "result": _result_of(e),
            "outcome": e.outcome,
            "on_target": bool(shot.on_target) if shot else None,
            "xg": round(float(shot.xg), 3) if shot and shot.xg is not None else None,
            "xgot": round(float(shot.psxg), 3) if shot and shot.psxg is not None else None,
            "x": x, "y": y, "end_x": ex, "end_y": ey,
            "end_known": has_end,
            "situation": (shot.situation if shot else None) or details.get("situation"),
            "shot_type": (shot.shot_type if shot else None) or details.get("shot_type"),
            "body_part": shot.body_part if shot else None,
            "assisted_by": details.get("assisted_by"),
            "last_action": details.get("last_action"),
        })
    return out


# --------------------------------------------------------------------------
# Mapa de calor (densidade de finalizações, ponderada por xG)
# --------------------------------------------------------------------------
def _heat_from_shots(shots: List[Dict[str, Any]], team: str) -> List[Dict[str, Any]]:
    grid: Dict[Tuple[int, int], float] = defaultdict(float)
    for s in shots:
        if s["team"] != team:
            continue
        cx = min(HEAT_COLS - 1, int(s["x"] / 100 * HEAT_COLS))
        cy = min(HEAT_ROWS - 1, int(s["y"] / 100 * HEAT_ROWS))
        grid[(cx, cy)] += (s["xg"] if s["xg"] is not None else 0.08) + 0.02
    if not grid:
        return []
    peak = max(grid.values())
    return [
        {
            "x": round((cx + 0.5) / HEAT_COLS * 100, 1),
            "y": round((cy + 0.5) / HEAT_ROWS * 100, 1),
            "intensity": round(max(0.25, v / peak), 2),
        }
        for (cx, cy), v in grid.items()
    ]


# --------------------------------------------------------------------------
# Localiza chutes: própria partida → gêmea (outra fonte) → forma recente
# --------------------------------------------------------------------------
def _twin_match(db: Session, m: Match, home_ids: List[int], away_ids: List[int]) -> Optional[Match]:
    q = (
        select(Match)
        .options(selectinload(Match.home_team), selectinload(Match.away_team))
        .where(Match.id != m.id, Match.home_team_id.in_(home_ids), Match.away_team_id.in_(away_ids))
    )
    for cand in db.scalars(q).all():
        if abs(cand.kickoff_time - m.kickoff_time) <= timedelta(days=1):
            if _load_shot_events(db, [cand.id]):
                return cand
    return None


def _recent_match_ids(db: Session, team_ids: List[int], before, limit: int) -> List[int]:
    if not team_ids:
        return []
    q = (
        select(Match.id)
        .where(
            or_(Match.home_team_id.in_(team_ids), Match.away_team_id.in_(team_ids)),
            Match.kickoff_time < before,
            Match.status == "finished",
            Match.id.in_(
                select(Event.match_id).where(Event.type == EventType.SHOT, Event.team_id.in_(team_ids))
            ),
        )
        .order_by(desc(Match.kickoff_time))
        .limit(limit)
    )
    return list(db.scalars(q).all())


def _team_shots_recent(db: Session, team_ids: List[int], before, limit: int, side: str) -> Tuple[List[Dict], List[int]]:
    ids = _recent_match_ids(db, team_ids, before, limit)
    events = [e for e in _load_shot_events(db, ids) if e.team_id in set(team_ids)]
    matches = {
        mm.id: mm for mm in db.scalars(
            select(Match).options(selectinload(Match.home_team), selectinload(Match.away_team))
            .where(Match.id.in_(ids))
        ).all()
    } if ids else {}
    # Todos os chutes do time são "dele": força o lado pedido.
    shots = _serialize_shots(events, set(team_ids) if side == "home" else set(), matches)
    return shots, ids


# --------------------------------------------------------------------------
# Escalação
# --------------------------------------------------------------------------
def _lineup_for_match(db: Session, match: Match) -> Dict[str, Any]:
    """Escalação da partida SEM os gols.

    Não usa ``lineups.match_lineups``: ele chama ``match_goals``, que lê todos os
    gols do banco e faz uma consulta por gol (lento com banco remoto).
    """
    official = official_lineups(db, match)
    if official["home"] or official["away"]:
        return {"source": "official", "formation": FORMATION,
                "home": _place(official, "home"), "away": _place(official, "away")}
    home = estimated_lineup(db, match.home_team_id)
    away = estimated_lineup(db, match.away_team_id)
    return {"source": "estimated" if (home or away) else "none",
            "formation": FORMATION if (home or away) else None, "home": home, "away": away}


def _lineup_side(db: Session, raw: List[Dict[str, Any]], team_ids: List[int], away: bool) -> List[Dict[str, Any]]:
    if not raw:
        for tid in team_ids:
            raw = estimated_lineup(db, tid)
            if raw:
                break
    out = []
    for p in raw:
        x, y = _flip(p.get("pitch_x", 50), p.get("pitch_y", 50), away)
        out.append({
            "player_id": p.get("player_id"),
            "name": p.get("player_name"),
            "position": p.get("position"),
            "line": p.get("line"),
            "line_label": _LINE_LABEL.get(p.get("line") or "", None),
            "shirt_number": p.get("shirt_number"),
            "estimated": bool(p.get("estimated")),
            "pitch_x": x, "pitch_y": y,
        })
    return out


# --------------------------------------------------------------------------
# Fichas de jogador
# --------------------------------------------------------------------------
def _season_stats(db: Session, player_ids: List[int], season_id: Optional[int]) -> Dict[int, Dict[str, Any]]:
    if not player_ids:
        return {}
    rows = db.scalars(
        select(PlayerStatistics)
        .where(PlayerStatistics.player_id.in_(player_ids))
        .order_by(PlayerStatistics.season_id.desc())
    ).all()
    best: Dict[int, PlayerStatistics] = {}
    for r in rows:
        cur = best.get(r.player_id)
        if cur is None or (season_id is not None and r.season_id == season_id and cur.season_id != season_id):
            best[r.player_id] = r
    return {
        pid: {
            "matches": r.matches_played, "minutes": r.minutes_played,
            "goals": r.goals, "assists": r.assists, "shots": r.shots,
            "shots_on_target": r.shots_on_target or None,
            "xg": round(r.xg_total or 0, 2), "xa": round(r.xa_total or 0, 2),
            "key_passes": r.key_passes,
        }
        for pid, r in best.items()
    }


def _minutes_in_match(db: Session, match_ids: List[int], player_ids: List[int]) -> Dict[int, int]:
    if not match_ids or not player_ids:
        return {}
    out: Dict[int, int] = {}
    for row in db.scalars(select(Lineup).where(Lineup.match_id.in_(match_ids), Lineup.player_id.in_(player_ids))).all():
        if row.minutes_played:
            out[row.player_id] = max(out.get(row.player_id, 0), row.minutes_played)
    for row in db.scalars(select(PlayerMatchStatistics).where(
            PlayerMatchStatistics.match_id.in_(match_ids), PlayerMatchStatistics.player_id.in_(player_ids))).all():
        if row.minutes_played:
            out[row.player_id] = max(out.get(row.player_id, 0), row.minutes_played)
    return out


def _build_players(
    db: Session, shots: List[Dict[str, Any]], lineups: Dict[str, List[Dict[str, Any]]],
    match_ids: List[int], season_id: Optional[int],
) -> List[Dict[str, Any]]:
    """Uma ficha por jogador que aparece nos chutes (autor ou assistente)."""
    agg: Dict[str, Dict[str, Any]] = {}

    def entry(name: Optional[str], pid: Optional[int], team: str) -> Optional[Dict[str, Any]]:
        if not name:
            return None
        key = f"{team}:{norm_person(name)}"
        if key not in agg:
            agg[key] = {
                "key": key, "player_id": pid, "name": name, "team": team,
                "shirt_number": None, "position": None, "minutes": None,
                "match": {"goals": 0, "assists": 0, "shots": 0, "shots_on_target": 0,
                          "xg": 0.0, "xa": 0.0, "key_passes": 0},
                "season": None,
            }
        elif pid and not agg[key]["player_id"]:
            agg[key]["player_id"] = pid
        return agg[key]

    for s in shots:
        shooter = entry(s["player"], s["player_id"], s["team"])
        if shooter:
            m = shooter["match"]
            m["shots"] += 1
            m["xg"] += s["xg"] or 0.0
            if s["result"] in ("goal", "saved"):
                m["shots_on_target"] += 1
            if s["result"] == "goal":
                m["goals"] += 1
        helper = entry(s["assisted_by"], None, s["team"])
        if helper:
            helper["match"]["key_passes"] += 1
            helper["match"]["xa"] += s["xg"] or 0.0
            if s["result"] == "goal":
                helper["match"]["assists"] += 1

    # vincula escalação ↔ ficha (por nome) para trazer camisa/posição
    for side in ("home", "away"):
        for lp in lineups.get(side, []):
            ln = norm_person(lp.get("name"))
            for rec in agg.values():
                if rec["team"] == side and _same_person(ln, norm_person(rec["name"])):
                    lp["detail_key"] = rec["key"]
                    rec["shirt_number"] = lp.get("shirt_number")
                    rec["position"] = lp.get("position") or lp.get("line_label")
                    if not rec["player_id"]:
                        rec["player_id"] = lp.get("player_id")
                    break

    pids = [r["player_id"] for r in agg.values() if r["player_id"]]
    season = _season_stats(db, pids, season_id)
    minutes = _minutes_in_match(db, match_ids, pids)
    for rec in agg.values():
        m = rec["match"]
        m["xg"], m["xa"] = round(m["xg"], 2), round(m["xa"], 2)
        pid = rec["player_id"]
        if pid:
            rec["season"] = season.get(pid)
            rec["minutes"] = minutes.get(pid)
    return sorted(agg.values(), key=lambda r: (-r["match"]["xg"], r["name"] or ""))


# --------------------------------------------------------------------------
# Entrada principal
# --------------------------------------------------------------------------
def build_studio_payload(db: Session, match_id: int) -> Optional[Dict[str, Any]]:
    m = db.scalar(
        select(Match)
        .options(selectinload(Match.home_team), selectinload(Match.away_team),
                 selectinload(Match.season), selectinload(Match.stadium))
        .where(Match.id == match_id)
    )
    if m is None:
        return None

    home_ids = _team_ids_like(db, m.home_team)
    away_ids = _team_ids_like(db, m.away_team)
    notes: List[str] = []
    linked_match_id: Optional[int] = None
    recent_ids: Dict[str, List[int]] = {"home": [], "away": []}

    finished = (m.status or "").lower() == "finished"

    own = _load_shot_events(db, [m.id])
    twin: Optional[Match] = None
    if not own:
        twin = _twin_match(db, m, home_ids, away_ids)

    if own:
        mode = "match"
        sources = {m.id: m}
        shots = _serialize_shots(own, {m.home_team_id}, sources)
        used_match_ids = [m.id]
        data_source = getattr(m.data_source, "value", m.data_source)
    elif twin is not None:
        mode = "match"
        linked_match_id = twin.id
        shots = _serialize_shots(_load_shot_events(db, [twin.id]), {twin.home_team_id}, {twin.id: twin})
        used_match_ids = [twin.id]
        data_source = getattr(twin.data_source, "value", twin.data_source)
        notes.append("Chutes vindos da mesma partida em outra fonte de dados (vínculo por times e data).")
    elif finished:
        # Jogo que já aconteceu: nunca mistura chutes de outros jogos no lugar.
        mode = "none"
        shots = []
        used_match_ids = []
        data_source = None
        notes.append(
            "Esta partida já terminou, mas a fonte ainda não publicou os chutes dela "
            "(o Understat cobre Premier League, La Liga, Bundesliga, Serie A e Ligue 1, e publica com atraso). "
            "Não exibimos chutes de outros jogos no lugar."
        )
    else:
        # Jogo futuro: padrão recente de cada time (pré-jogo).
        h_shots, h_ids = _team_shots_recent(db, home_ids, m.kickoff_time, RECENT_MATCHES, "home")
        a_shots, a_ids = _team_shots_recent(db, away_ids, m.kickoff_time, RECENT_MATCHES, "away")
        shots = h_shots + a_shots
        recent_ids = {"home": h_ids, "away": a_ids}
        used_match_ids = h_ids + a_ids
        mode = "recent_form" if shots else "none"
        data_source = None
        if shots:
            notes.append(
                f"Sem eventos desta partida: exibindo os chutes dos últimos jogos de cada time "
                f"({len(h_ids)} do mandante, {len(a_ids)} do visitante)."
            )
        else:
            notes.append(
                "Nenhuma fonte tem chutes para estes times. O Understat cobre apenas Premier League, "
                "La Liga, Bundesliga, Serie A e Ligue 1 (não cobre o Brasileirão)."
            )

    if shots and not any(s["end_known"] for s in shots):
        notes.append("A fonte não informa onde a bola foi: a linha do chute aponta para o centro do gol.")
    if shots and all(s["xgot"] is None for s in shots):
        notes.append("xGOT não é fornecido pela fonte (aparece como —).")

    lineup_payload = _lineup_for_match(db, m)
    if not (lineup_payload["home"] or lineup_payload["away"]) and linked_match_id:
        twin_match = db.get(Match, linked_match_id)
        if twin_match is not None:
            lineup_payload = _lineup_for_match(db, twin_match)
    lineups = {
        "home": _lineup_side(db, lineup_payload["home"], home_ids, away=False),
        "away": _lineup_side(db, lineup_payload["away"], away_ids, away=True),
    }
    if not (lineups["home"] or lineups["away"]):
        notes.append("Escalação indisponível: elenco ainda não sincronizado para estes times.")
    elif any(p["estimated"] for p in lineups["home"] + lineups["away"]):
        notes.append("Escalação provável (elenco + minutos na temporada), não a oficial.")

    players = _build_players(db, shots, lineups, used_match_ids, m.season_id)

    comp = m.season.competition.name if m.season and m.season.competition else None
    return {
        "match_id": m.id,
        "linked_match_id": linked_match_id,
        "mode": mode,
        "source": data_source,
        "match": {
            "home": {"id": m.home_team_id, "name": m.home_team.name if m.home_team else None,
                     "logo_url": resolve_crest(m.home_team.name if m.home_team else None,
                                               m.home_team.logo_url if m.home_team else None)},
            "away": {"id": m.away_team_id, "name": m.away_team.name if m.away_team else None,
                     "logo_url": resolve_crest(m.away_team.name if m.away_team else None,
                                               m.away_team.logo_url if m.away_team else None)},
            "home_score": m.home_score, "away_score": m.away_score,
            "status": m.status,
            "kickoff_time": m.kickoff_time.isoformat() if m.kickoff_time else None,
            "competition": comp, "round_name": m.round_name,
            "venue": m.stadium.name if m.stadium else None,
            "match_data_source": getattr(m.data_source, "value", m.data_source),
        },
        "recent_match_ids": recent_ids,
        "shots": shots,
        "heatmap": {
            "kind": "shots_xg",
            "home": _heat_from_shots(shots, "home"),
            "away": _heat_from_shots(shots, "away"),
        },
        "lineups": {**lineups, "source": lineup_payload.get("source"), "formation": lineup_payload.get("formation")},
        "players": players,
        "coverage": {
            "shots": len(shots),
            "has_shots": bool(shots),
            "has_lineup": bool(lineups["home"] or lineups["away"]),
            "has_xg": any(s["xg"] is not None for s in shots),
            "has_end_location": any(s["end_known"] for s in shots),
            "notes": notes,
        },
    }