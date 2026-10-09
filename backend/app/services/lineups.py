"""Escalação de uma partida.

Duas fontes, sempre declaradas em ``source``:

* ``official`` — escalação real gravada em ``lineup``.
* ``estimated`` — provável XI montado a partir do elenco sincronizado
  (``player.team_id``), priorizando quem tem mais minutos na temporada.

Nada aqui é inventado: sem elenco devolve lista vazia e a tela mostra o
estado vazio em vez de dados fabricados.
"""
from typing import Any, Dict, List, Optional

import re

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from app.db.models import Event, Goal, Lineup, Match, Player

# Formação base 4-3-3: (linha, x, [ys]) em coordenadas de campo 0..100.
FORMATION = "4-3-3"
_LINES = [
    ("GK", 8, [50]),
    ("DEF", 26, [16, 38, 62, 84]),
    ("MID", 50, [22, 50, 78]),
    ("ATT", 74, [18, 50, 82]),
]
_CAPACITY = {"GK": 1, "DEF": 4, "MID": 3, "ATT": 3}
_FILL_ORDER = {"GK": ["DEF", "MID"], "DEF": ["MID", "ATT"],
               "MID": ["DEF", "ATT"], "ATT": ["MID", "DEF"]}

# Palavras-chave das posições textuais do football-data/StatsBomb por linha.
# A ordem importa: "Left Back" precisa casar DEF antes de qualquer regra de MID,
# e "Center Defensive Midfield" precisa casar MID (não DEF por "defensive").
_LINE_BY_KEYWORD = [
    ("GK", ("goalkeeper", "keeper", "gk")),
    ("DEF", ("back", "centre-back", "center-back", "cb", "lb", "rb", "lwb", "rwb",
             "defence", "defense", "defender")),
    ("MID", ("midfield", "midfielder", "cdm", "cm", "cam", "dm", "am", "meia",
             "defensive midfield")),
    ("ATT", ("forward", "winger", "wing", "striker", "st", "cf", "attack",
             "attacker", "attacking", "ataque", "atacante", "offence", "offense")),
]


def _line_of(position: Optional[str]) -> Optional[str]:
    """Classifica a posição textual numa das 4 linhas do 4-3-3.

    Expressões com espaço casam como frase; abreviações curtas casam por
    palavra inteira, para "am" não casar dentro de outra palavra.
    """
    if not position:
        return None
    text = position.lower().strip()
    for line, keywords in _LINE_BY_KEYWORD:
        for keyword in keywords:
            if " " in keyword:
                if keyword in text:
                    return line
            elif re.search(rf"\b{re.escape(keyword)}\b", text):
                return line
    return None


def _display_name(p: Optional[Player]) -> Optional[str]:
    if p is None:
        return None
    return p.display_name or p.last_name or f"Jogador {p.id}"


def _minutes_by_player(db: Session, player_ids: List[int]) -> Dict[int, int]:
    """Minutos jogados na temporada, para ordenar a provável XI por utilização."""
    if not player_ids:
        return {}
    from app.db.models import PlayerStatistics

    rows = db.scalars(
        select(PlayerStatistics).where(PlayerStatistics.player_id.in_(player_ids))
    ).all()
    out: Dict[int, int] = {}
    for row in rows:
        out[row.player_id] = max(out.get(row.player_id, 0), int(row.minutes_played or 0))
    return out


def official_lineups(db: Session, match: Match) -> Dict[str, List[Dict[str, Any]]]:
    """Escalação oficial gravada no banco (vazia quando nunca foi importada)."""
    out: Dict[str, List[Dict[str, Any]]] = {"home": [], "away": []}
    rows = db.scalars(
        select(Lineup)
        .where(Lineup.match_id == match.id)
        .order_by(desc(Lineup.is_starter), Lineup.shirt_number, Lineup.id)
    ).all()
    for lu in rows:
        side = "home" if lu.team_id == match.home_team_id else "away"
        out[side].append({
            "player_id": lu.player_id,
            "player_name": _display_name(db.get(Player, lu.player_id)),
            "is_starter": bool(lu.is_starter),
            "position": lu.position,
            "shirt_number": lu.shirt_number,
            "minutes_played": lu.minutes_played,
        })
    return out


def _place(official: Dict[str, List[Dict[str, Any]]], side: str) -> List[Dict[str, Any]]:
    """Distribui os titulares oficiais nas coordenadas 4-3-3 pela posição declarada."""
    starters = [p for p in official[side] if p["is_starter"]]
    buckets: Dict[str, List[Dict[str, Any]]] = {line: [] for line in _CAPACITY}
    orphans: List[Dict[str, Any]] = []
    for p in starters:
        line = _line_of(p.get("position"))
        if line and len(buckets[line]) < _CAPACITY[line]:
            buckets[line].append(p)
        else:
            orphans.append(p)
    for p in orphans:
        for line in ("DEF", "MID", "ATT", "GK"):
            if len(buckets[line]) < _CAPACITY[line]:
                buckets[line].append(p)
                break
    out: List[Dict[str, Any]] = []
    for line, x, ys in _LINES:
        for index, y in enumerate(ys):
            if index < len(buckets[line]):
                entry = dict(buckets[line][index])
                entry.update({"estimated": False, "line": line,
                              "pitch_x": x, "pitch_y": y})
                out.append(entry)
    return out


def estimated_lineup(db: Session, team_id: int) -> List[Dict[str, Any]]:
    """Provável XI do time a partir do elenco sincronizado (1-4-3-3).

    Ordena cada linha por minutos jogados na temporada e completa linhas
    faltantes com jogadores de outras linhas, para sempre devolver 11 quando
    o elenco tem jogadores suficientes.
    """
    squad = list(db.scalars(
        select(Player).where(Player.team_id == team_id).order_by(Player.last_name)
    ).all())
    if not squad:
        return []

    minutes = _minutes_by_player(db, [p.id for p in squad])
    by_line: Dict[str, List[Player]] = {line: [] for line in _CAPACITY}
    by_line["?"] = []
    for p in squad:
        by_line[_line_of(p.position) or "?"].append(p)
    for players in by_line.values():
        players.sort(key=lambda p: (-minutes.get(p.id, 0), (p.last_name or "").lower()))

    taken: set = set()

    def take(line: str, count: int) -> List[Player]:
        picked = []
        for p in by_line.get(line, []):
            if len(picked) >= count:
                break
            if p.id in taken:
                continue
            picked.append(p)
            taken.add(p.id)
        return picked

    chosen: List[Player] = []
    for line, count in _CAPACITY.items():
        picked = take(line, count)
        missing = count - len(picked)
        for fallback in _FILL_ORDER[line]:
            if missing <= 0:
                break
            extra = take(fallback, missing)
            picked.extend(extra)
            missing -= len(extra)
        chosen.extend(picked)
    for p in squad:  # completa se o elenco ainda não fechou 11
        if len(chosen) >= 11:
            break
        if p.id not in taken:
            chosen.append(p)
            taken.add(p.id)

    out: List[Dict[str, Any]] = []
    # Distribui nas coordenadas: cada linha recebe quem foi escolhido para ela,
    # na ordem de prioridade (minutos jogados, depois nome).
    buckets: Dict[str, List[Player]] = {line: [] for line in _CAPACITY}
    for p in chosen:
        line = _line_of(p.position)
        if line is None or len(buckets[line]) >= _CAPACITY[line]:
            for candidate in ("DEF", "MID", "ATT", "GK"):
                if len(buckets[candidate]) < _CAPACITY[candidate]:
                    line = candidate
                    break
        if line is None:
            continue
        buckets[line].append(p)

    for line, x, ys in _LINES:
        for index, y in enumerate(ys):
            if index >= len(buckets[line]):
                continue
            pick = buckets[line][index]
            out.append({
                "player_id": pick.id,
                "player_name": _display_name(pick),
                "position": pick.position,
                "shirt_number": None,
                "minutes_played": minutes.get(pick.id),
                "is_starter": True,
                "pitch_x": x,
                "pitch_y": y,
                "line": line,
                "estimated": True,
            })
    return out


def match_goals(db: Session, match_id: int) -> List[Dict[str, Any]]:
    """Gols da partida: quem marcou, minuto, assistência, pênalti/gol-contra."""
    goals: List[Dict[str, Any]] = []
    for g in db.scalars(select(Goal)).all():
        event = db.get(Event, g.event_id) if g.event_id else None
        if event is None or event.match_id != match_id:
            continue
        scorer = db.get(Player, g.scorer_player_id)
        assist = db.get(Player, g.assist_player_id) if g.assist_player_id else None
        goals.append({
            "minute": event.minute,
            "team_id": event.team_id,
            "scorer_player_id": g.scorer_player_id,
            "scorer_name": _display_name(scorer),
            "assist_player_id": g.assist_player_id,
            "assist_name": _display_name(assist),
            "is_penalty": bool(g.is_penalty),
            "is_own_goal": bool(g.is_own_goal),
        })
    goals.sort(key=lambda g: (g["minute"] is None, g["minute"] or 0))
    return goals


def match_lineups(db: Session, match_id: int) -> Dict[str, Any]:
    """Payload de escalação + gols da partida para a tela de confronto."""
    empty = {"match_id": match_id, "source": "none", "formation": None,
             "home": [], "away": [], "goals": []}
    match = db.get(Match, match_id)
    if not match:
        return empty

    official = official_lineups(db, match)
    if official["home"] or official["away"]:
        return {
            "match_id": match_id,
            "source": "official",
            "formation": FORMATION,
            "home": _place(official, "home"),
            "away": _place(official, "away"),
            "goals": match_goals(db, match_id),
        }

    home = estimated_lineup(db, match.home_team_id)
    away = estimated_lineup(db, match.away_team_id)
    return {
        "match_id": match_id,
        "source": "estimated" if (home or away) else "none",
        "formation": FORMATION if (home or away) else None,
        "home": home,
        "away": away,
        "goals": match_goals(db, match_id),
    }



