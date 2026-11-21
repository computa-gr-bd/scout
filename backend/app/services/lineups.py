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


# Abreviações curtas (Understat, ESPN, StatsBomb) -> linha do 4-3-3.
# ESPN manda "G", "CD-L", "CD-R", "LB", "DM", "CM-L", "AM", "LW", "CF-R", "F"...
# Sem "G"/"CD"/"LW"/"RW" na tabela o goleiro virava "órfão" e acabava na zaga,
# empurrando um zagueiro para o gol.
_TOKEN_LINE = {
    # goleiro
    "gk": "GK", "g": "GK", "goalkeeper": "GK", "goalie": "GK", "keeper": "GK",
    # defesa
    "d": "DEF", "df": "DEF", "def": "DEF", "cd": "DEF", "cb": "DEF", "lb": "DEF", "rb": "DEF",
    "lwb": "DEF", "rwb": "DEF", "wb": "DEF", "sw": "DEF",
    # meio
    "m": "MID", "mf": "MID", "mid": "MID", "dm": "MID", "cdm": "MID", "cm": "MID", "cam": "MID",
    "am": "MID", "lm": "MID", "rm": "MID",
    # ataque
    "f": "ATT", "fw": "ATT", "cf": "ATT", "st": "ATT", "ss": "ATT", "lw": "ATT", "rw": "ATT",
    "lf": "ATT", "rf": "ATT",
}
# Sufixos de lado/estado que não dizem a linha: "CD-L", "CM-R", "S" (reserva do Understat).
_NOISE_TOKENS = {"l", "r", "c", "s", "sub"}


def _line_of(position: Optional[str]) -> Optional[str]:
    """Classifica a posição textual numa das 4 linhas do 4-3-3.

    1) Abreviações (Understat "D M S", ESPN "CD-L"/"G"/"LW"): a primeira sigla
       significativa define a linha.
    2) Expressões por extenso ("Left Back", "Center Defensive Midfield"): casam por
       frase/palavra inteira, na ordem GK > DEF > MID > ATT.
    """
    if not position:
        return None
    text = position.lower().strip()
    tokens = re.findall(r"[a-z]+", text)
    meaningful = [t for t in tokens if t not in _NOISE_TOKENS]
    if meaningful and all(t in _TOKEN_LINE for t in meaningful):
        return _TOKEN_LINE[meaningful[0]]
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


def _goalkeeper_evidence(db: Session, team_id: int, player_ids: List[int]) -> Dict[int, int]:
    """Quantos jogos cada jogador teve como GOLEIRO, por fontes independentes do cadastro.

    ``Player.position`` costuma vir vazio para goleiros (o Understat só grava a posição em
    ``recent_form`` e o ESPN usa "G"), e sem isso o provável XI saía sem goleiro. Aqui vale
    qualquer sinal de que o jogador jogou no gol por ESTE time:

    1. escalações (``lineup``) cuja posição naquele jogo é de goleiro;
    2. estatísticas por partida (``player_match_statistics``) com posição de goleiro ou defesas;
    3. agregados já derivados (``supplemental_stats``: ``derived.gk_matches`` / ``soccerdata.gk_sota``).

    Titular pesa 2, reserva 1. Devolve ``{player_id: pontos}`` só para quem tem evidência.
    """
    from app.db.models import PlayerMatchStatistics, PlayerStatistics

    score: Dict[int, int] = {}

    def add(pid: Optional[int], n: int = 1) -> None:
        if pid:
            score[pid] = score.get(pid, 0) + n

    for pid, pos, starter in db.execute(
        select(Lineup.player_id, Lineup.position, Lineup.is_starter)
        .where(Lineup.team_id == team_id, Lineup.position.isnot(None))
    ).all():
        if _line_of(pos) == "GK":
            add(pid, 2 if starter else 1)

    for pid, pos, saves, starter in db.execute(
        select(PlayerMatchStatistics.player_id, PlayerMatchStatistics.position,
               PlayerMatchStatistics.saves, PlayerMatchStatistics.is_starter)
        .where(PlayerMatchStatistics.team_id == team_id)
    ).all():
        if _line_of(pos) == "GK" or (saves or 0) > 0:
            add(pid, 2 if starter else 1)

    if player_ids:
        for pid, supplemental in db.execute(
            select(PlayerStatistics.player_id, PlayerStatistics.supplemental_stats)
            .where(PlayerStatistics.player_id.in_(player_ids))
        ).all():
            if not isinstance(supplemental, dict):
                continue
            derived = supplemental.get("derived") or {}
            provider = supplemental.get("soccerdata") or {}
            games = int(derived.get("gk_matches") or 0) if isinstance(derived, dict) else 0
            if games <= 0 and isinstance(provider, dict) and (provider.get("gk_sota") or 0) > 0:
                games = 1
            add(pid, games)
    return score


def official_lineups(db: Session, match: Match) -> Dict[str, List[Dict[str, Any]]]:
    """Escalação oficial gravada no banco (vazia quando nunca foi importada).

    Além da posição do próprio jogo (``position``), devolve posições de reserva
    (``player_position`` do cadastro e ``stats_position`` das estatísticas) para
    classificar quem veio sem posição reconhecível — principalmente o goleiro.
    """
    out: Dict[str, List[Dict[str, Any]]] = {"home": [], "away": []}
    rows = db.scalars(
        select(Lineup)
        .where(Lineup.match_id == match.id)
        .order_by(desc(Lineup.is_starter), Lineup.shirt_number, Lineup.id)
    ).all()
    ids = [lu.player_id for lu in rows if lu.player_id]
    stats = _stats_by_player(db, ids)
    gk_score = {
        team_id: _goalkeeper_evidence(db, team_id, ids)
        for team_id in {lu.team_id for lu in rows}
    }
    for lu in rows:
        side = "home" if lu.team_id == match.home_team_id else "away"
        player = db.get(Player, lu.player_id)
        out[side].append({
            "player_id": lu.player_id,
            "player_name": _display_name(player),
            "is_starter": bool(lu.is_starter),
            "position": lu.position,
            "player_position": player.position if player else None,
            "stats_position": stats.get(lu.player_id, {}).get("position"),
            "gk_evidence": gk_score.get(lu.team_id, {}).get(lu.player_id, 0),
            "shirt_number": lu.shirt_number,
            "minutes_played": lu.minutes_played,
        })
    return out


_GK_SHIRTS = (12, 13, 21, 22, 23, 24, 25, 30, 31, 40, 41)


def _starter_line(p: Dict[str, Any]) -> Optional[str]:
    """Linha do titular: posição do jogo; se não reconhecida, cadastro e estatísticas."""
    line = (
        _line_of(p.get("position"))
        or _line_of(p.get("player_position"))
        or _line_of(p.get("stats_position"))
    )
    if line is None and (p.get("gk_evidence") or 0) > 0:
        return "GK"
    return line


def _place(official: Dict[str, List[Dict[str, Any]]], side: str) -> List[Dict[str, Any]]:
    """Distribui os titulares oficiais nas coordenadas 4-3-3 pela posição declarada.

    O goleiro só ocupa a vaga de goleiro, e jogador de linha nunca é colocado no gol:
    antes, quem não tinha posição reconhecida caía em DEF/MID/ATT/GK nessa ordem, então
    o goleiro "sem posição" ia para a zaga e um zagueiro sobrava para o gol.
    """
    starters = [p for p in official[side] if p["is_starter"]]
    buckets: Dict[str, List[Dict[str, Any]]] = {line: [] for line in _CAPACITY}
    orphans: List[Dict[str, Any]] = []
    for p in starters:
        line = _starter_line(p)
        if line and len(buckets[line]) < _CAPACITY[line]:
            buckets[line].append(p)
        else:
            orphans.append(p)

    # Sem goleiro identificado: tenta pela camisa (1 e numerações típicas de goleiro),
    # mas só entre quem não tem posição reconhecida.
    if not buckets["GK"]:
        unknown = [p for p in orphans if _starter_line(p) is None]
        pick = next((p for p in unknown if p.get("shirt_number") == 1), None)
        if pick is None:
            free_outfield = sum(_CAPACITY[l] - len(buckets[l]) for l in ("DEF", "MID", "ATT"))
            if len(orphans) > free_outfield:
                pick = next((p for p in unknown if p.get("shirt_number") in _GK_SHIRTS), None)
        if pick is not None:
            buckets["GK"].append(pick)
            orphans.remove(pick)

    # Sobras de linha (ex.: 4-2-3-1 com 4 meias): ocupam a vaga livre mais próxima, nunca o gol.
    for p in orphans:
        preferred = _starter_line(p)
        order = [preferred] if preferred and preferred != "GK" else []
        order += [l for l in ("DEF", "MID", "ATT") if l not in order]
        for line in order:
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
    gk_evidence = _goalkeeper_evidence(db, team_id, [p.id for p in squad])

    def minutes_of(p: Player) -> int:
        return stats.get(p.id, {}).get("minutes", 0)

    def line_of_player(p: Player) -> Optional[str]:
        line = _line_of(p.position) or _line_of(stats.get(p.id, {}).get("position"))
        # Sem posição cadastrada, mas com jogos de goleiro comprovados -> é o goleiro.
        if line is None and gk_evidence.get(p.id, 0) > 0:
            return "GK"
        return line

    def rank(p: Player):
        return (0 if p.id in played_ids else 1, -minutes_of(p), (p.last_name or "").lower())

    by_line: Dict[str, List[Player]] = {line: [] for line in _CAPACITY}
    unknown: List[Player] = []
    for p in squad:
        line = line_of_player(p)
        (by_line[line] if line else unknown).append(p)
    for players in by_line.values():
        players.sort(key=rank)
    # Goleiro titular = quem mais jogou no gol (evidência), depois minutos.
    by_line["GK"].sort(key=lambda p: (0 if p.id in played_ids else 1,
                                      -gk_evidence.get(p.id, 0), -minutes_of(p),
                                      (p.last_name or "").lower()))
    unknown.sort(key=rank)

    # Goleiro que jogou pelo time mas não está no elenco sincronizado (player.team_id
    # diferente/vazio): entra como candidato se o time ficaria sem goleiro.
    if not by_line["GK"]:
        squad_ids = {p.id for p in squad}
        outside = [pid for pid in gk_evidence if pid not in squad_ids]
        if outside:
            best = db.scalars(select(Player).where(Player.id.in_(outside))).all()
            best.sort(key=lambda p: -gk_evidence.get(p.id, 0))
            if best:
                by_line["GK"].append(best[0])
                stats.setdefault(best[0].id, {"minutes": 0, "position": None})

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
    """Gols da partida: quem marcou, minuto, assistência, pênalti/gol-contra.

    Uma única consulta com JOIN filtra gols pelo match_id e carrega jogador/
    evento em lote, eliminando o select(Goal).all() + N+1 de db.get.
    """
    from sqlalchemy.orm import selectinload, joinedload

    rows = db.execute(
        select(Goal, Event.minute, Event.team_id)
        .join(Event, Event.id == Goal.event_id)
        .options(
            selectinload(Goal.scorer),
            selectinload(Goal.assist),
        )
        .where(Event.match_id == match_id)
    ).all()

    goals: List[Dict[str, Any]] = []
    for g, minute, team_id in rows:
        scorer = g.scorer
        assist = g.assist
        goals.append({
            "minute": minute,
            "team_id": team_id,
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



