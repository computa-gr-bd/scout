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


_UNDERSTAT_CODES = {"gk": "GK", "d": "DEF", "m": "MID", "f": "ATT", "fw": "ATT"}


def _line_of(position: Optional[str]) -> Optional[str]:
    """Classifica a posição textual numa das 4 linhas do 4-3-3.

    Expressões com espaço casam como frase; abreviações curtas casam por
    palavra inteira, para "am" não casar dentro de outra palavra.
    """
    if not position:
        return None
    text = position.lower().strip()
    # Understat: "GK", "D", "M", "F" e "S" (reserva), combináveis ("D M S").
    # A primeira letra que não é "S" é a função principal do jogador.
    tokens = re.findall(r"[a-z]+", text)
    if tokens and all(t in _UNDERSTAT_CODES or t == "s" for t in tokens):
        for t in tokens:
            if t in _UNDERSTAT_CODES:
                return _UNDERSTAT_CODES[t]
        return None
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


def _stats_by_player(db: Session, player_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    """Minutos e posição por jogador.

    O Understat não grava ``Player.position``: a posição fica em
    ``PlayerStatistics.recent_form["position"]``. Sem ler isso, quase nenhum
    jogador era classificado numa linha e o XI saía incompleto/embaralhado.
    """
    if not player_ids:
        return {}
    from app.db.models import PlayerStatistics

    rows = db.scalars(
        select(PlayerStatistics)
        .where(PlayerStatistics.player_id.in_(player_ids))
        .order_by(desc(PlayerStatistics.season_id))
    ).all()
    out: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        cur = out.setdefault(row.player_id, {"minutes": 0, "position": None})
        cur["minutes"] = max(cur["minutes"], int(row.minutes_played or 0))
        form = row.recent_form if isinstance(row.recent_form, dict) else {}
        if cur["position"] is None and form.get("position"):
            cur["position"] = form["position"]  # linhas já vêm da temporada mais recente
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


def estimated_lineup(db: Session, team_id: int,
                     played_ids: Optional[set] = None) -> List[Dict[str, Any]]:
    """Provável XI do time a partir do elenco sincronizado (1-4-3-3).

    * Posição vem de ``Player.position`` ou, se vazia, das estatísticas
      (Understat grava D/M/F/GK lá).
    * Quem comprovadamente jogou a partida (``played_ids``, ex.: autores de
      chutes) tem prioridade; depois, mais minutos na temporada.
    * Linhas sem gente suficiente são completadas por outras linhas, para
      devolver 11 sempre que o elenco permitir.
    """
    squad = list(db.scalars(
        select(Player).where(Player.team_id == team_id).order_by(Player.last_name)
    ).all())
    if not squad:
        return []

    played_ids = played_ids or set()
    stats = _stats_by_player(db, [p.id for p in squad])

    def minutes_of(p: Player) -> int:
        return stats.get(p.id, {}).get("minutes", 0)

    def line_of_player(p: Player) -> Optional[str]:
        return _line_of(p.position) or _line_of(stats.get(p.id, {}).get("position"))

    def rank(p: Player):
        return (0 if p.id in played_ids else 1, -minutes_of(p), (p.last_name or "").lower())

    by_line: Dict[str, List[Player]] = {line: [] for line in _CAPACITY}
    unknown: List[Player] = []
    for p in squad:
        line = line_of_player(p)
        (by_line[line] if line else unknown).append(p)
    for players in by_line.values():
        players.sort(key=rank)
    unknown.sort(key=rank)

    taken: set = set()
    buckets: Dict[str, List[Player]] = {line: [] for line in _CAPACITY}

    def take_from(pool: List[Player], line: str) -> None:
        for p in pool:
            if len(buckets[line]) >= _CAPACITY[line]:
                return
            if p.id not in taken:
                buckets[line].append(p)
                taken.add(p.id)

    # 1) cada linha com quem é dela
    for line in _CAPACITY:
        take_from(by_line[line], line)
    # 2) vagas restantes: jogadores sem posição conhecida, depois sobras de outras linhas.
    #    O goleiro NUNCA é preenchido por jogador de linha: sem goleiro conhecido a
    #    vaga fica vazia (melhor que mostrar um atacante como "GOL").
    for line in _CAPACITY:
        if line != "GK":
            take_from(unknown, line)
    for line in _CAPACITY:
        if line == "GK":
            continue
        for fallback in _FILL_ORDER[line]:
            leftovers = [p for p in by_line[fallback] if p.id not in taken]
            # só empresta quem não é titular natural da própria linha
            take_from(leftovers, line)

    out: List[Dict[str, Any]] = []
    for line, x, ys in _LINES:
        for index, y in enumerate(ys):
            if index >= len(buckets[line]):
                continue
            pick = buckets[line][index]
            out.append({
                "player_id": pick.id,
                "player_name": _display_name(pick),
                "position": pick.position or stats.get(pick.id, {}).get("position"),
                "shirt_number": None,
                "minutes_played": minutes_of(pick) or None,
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



