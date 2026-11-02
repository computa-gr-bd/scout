"""Jogadores duplicados entre fontes (Understat × football-data × ...).

Cada fonte cadastra o clube e os jogadores por conta própria ("Arsenal" × "Arsenal FC",
"Gabriel" × "Gabriel Magalhães"): o mesmo jogador aparece em duas linhas, uma com as
estatísticas (Understat) e outra com a posição/nome completo (football-data). Aqui as duas
viram uma só **na leitura** (nada é apagado do banco).

Regras (mesmo clube, linhas de times cadastrados diferentes):

* nome igual, ou mesmo sobrenome + mesma inicial, ou nome curto contido no longo
  ("Vinicius Junior" ⊂ "Vinicius Jose Paixao de Oliveira Junior") → mesma pessoa;
* nome único ("Gabriel", "Rodri") só casa se for a única opção no elenco do outro lado ou se
  jogos/minutos/gols/assistências forem idênticos (desambigua Gabriel Magalhães × Jesus × Martinelli);
* nunca junta jogadores do MESMO cadastro de time, goleiro com jogador de linha ou datas de
  nascimento diferentes; cada jogador casa com no máximo um de cada outro cadastro.

O algoritmo (:func:`group_players`) é puro; :func:`duplicate_index` o alimenta com o banco e
guarda o resultado em cache por alguns minutos.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.services.position_index import classify_role
from app.services.studio import _same_team_name, norm_person, norm_team

_GENERIC_POSITIONS = {"defence", "defense", "midfield", "offence", "attack", "goalkeeper"}
_TTL = 300.0


@dataclass
class PRow:
    id: int
    team_id: int
    name: str
    position: Optional[str] = None
    dob: Optional[date] = None
    sig: Optional[Tuple[int, int, int, int]] = None  # (jogos, minutos, gols, assistências)
    richness: float = 0.0                            # quanto de estatística a linha carrega


@dataclass
class DuplicateIndex:
    canonical_of: Dict[int, int] = field(default_factory=dict)     # id -> id canônico
    members: Dict[int, List[int]] = field(default_factory=dict)    # canônico -> todos os ids


# --------------------------------------------------------------------------- nomes
def _name_match(ta: List[str], tb: List[str]) -> int:
    """3 = nome igual · 2 = forte (sobrenome+inicial, subconjunto) · 1 = fraco (nome único contido)."""
    if not ta or not tb:
        return 0
    if ta == tb:
        return 3
    if len(ta) >= 2 and len(tb) >= 2:
        if ta[-1] == tb[-1] and ta[0][0] == tb[0][0]:
            return 2
        short, long_ = (set(ta), set(tb)) if len(ta) <= len(tb) else (set(tb), set(ta))
        return 2 if short <= long_ else 0
    single, other = (ta, tb) if len(ta) == 1 else (tb, ta)
    if len(single) == 1 and len(other) >= 2 and len(single[0]) >= 3 and single[0] in set(other):
        return 1
    return 0


def _role(position: Optional[str]) -> Optional[str]:
    return classify_role(position) if position else None


def _blocked(a: PRow, b: PRow, level: int) -> bool:
    if a.dob and b.dob and a.dob != b.dob:
        return True
    ra, rb = _role(a.position), _role(b.position)
    if ra and rb and ra != rb:
        if "GK" in (ra, rb):
            return True          # goleiro nunca é jogador de linha
        return level < 2         # nome fraco + posições diferentes: não arrisca
    return False


def best_position(positions: Iterable[Optional[str]]) -> Optional[str]:
    """Posição mais específica: palavra específica (Centre-Back) > genérica (Defence) > sigla (D S)."""
    best, best_score = None, 0
    for pos in positions:
        if not pos or not pos.strip():
            continue
        text = pos.strip()
        if " " not in text and len(text) > 3:
            score = 2 if text.lower() in _GENERIC_POSITIONS else 3
        else:
            score = 1
        if score > best_score:
            best, best_score = text, score
    return best


def longest_name(names: Iterable[Optional[str]]) -> Optional[str]:
    """Nome mais completo (mais palavras, depois mais letras)."""
    best, key = None, (-1, -1)
    for n in names:
        if n and n.strip():
            k = (len(n.split()), len(n))
            if k > key:
                best, key = n.strip(), k
    return best


# --------------------------------------------------------------------------- agrupamento
def group_players(rows: List[PRow], team_group: Dict[int, int]) -> DuplicateIndex:
    """Agrupa jogadores duplicados. ``team_group``: id do time -> id do clube (times equivalentes)."""
    by_group: Dict[int, Dict[int, List[PRow]]] = {}
    for r in rows:
        g = team_group.get(r.team_id)
        if g is None:
            continue
        by_group.setdefault(g, {}).setdefault(r.team_id, []).append(r)

    parent: Dict[int, int] = {}

    def find(x: int) -> int:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    tokens = {r.id: norm_person(r.name).split() for r in rows}

    for teams in by_group.values():
        if len(teams) < 2:
            continue
        cands: List[Tuple[int, int, int, int]] = []   # (pontos, nível, id_a, id_b)
        team_ids = list(teams)
        for i, ta_id in enumerate(team_ids):
            for tb_id in team_ids[i + 1:]:
                for a in teams[ta_id]:
                    for b in teams[tb_id]:
                        level = _name_match(tokens[a.id], tokens[b.id])
                        if not level or _blocked(a, b, level):
                            continue
                        same_sig = bool(a.sig and a.sig == b.sig and a.sig[1] > 0)
                        cands.append((level * 10 + (5 if same_sig else 0), level, a.id, b.id))
        if not cands:
            continue
        rows_by_id = {r.id: r for t in teams.values() for r in t}
        # Nome fraco: só vale se for a única opção do jogador naquele elenco, ou se os números batem.
        fanout: Dict[Tuple[int, int], int] = {}
        for _, level, x, y in cands:
            if level == 1:
                fanout[(x, rows_by_id[y].team_id)] = fanout.get((x, rows_by_id[y].team_id), 0) + 1
                fanout[(y, rows_by_id[x].team_id)] = fanout.get((y, rows_by_id[x].team_id), 0) + 1
        used: set = set()
        for score, level, x, y in sorted(cands, key=lambda c: (-c[0], c[2], c[3])):
            a, b = rows_by_id[x], rows_by_id[y]
            if level == 1 and score < 15:
                single = x if len(tokens[x]) == 1 else y
                other_team = b.team_id if single == x else a.team_id
                if fanout.get((single, other_team), 0) != 1:
                    continue
            if (x, b.team_id) in used or (y, a.team_id) in used:
                continue
            used.add((x, b.team_id))
            used.add((y, a.team_id))
            parent[find(x)] = find(y)

    clusters: Dict[int, List[PRow]] = {}
    for r in rows:
        root = find(r.id)
        clusters.setdefault(root, []).append(r)

    out = DuplicateIndex()
    for members in clusters.values():
        if len(members) < 2:
            continue
        canon = max(members, key=lambda m: (m.richness, 1 if m.position else 0, -m.id))
        ids = [canon.id] + sorted(m.id for m in members if m.id != canon.id)
        out.members[canon.id] = ids
        for i in ids:
            out.canonical_of[i] = canon.id
    return out


def team_groups(teams: Iterable[Tuple[int, str]]) -> Dict[int, int]:
    """id do time -> id do clube (times de fontes diferentes com o mesmo nome normalizado)."""
    items = [(tid, norm_team(name)) for tid, name in teams]
    parent = {tid: tid for tid, _ in items}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    by_key: Dict[str, List[int]] = {}
    for tid, key in items:
        by_key.setdefault(key, []).append(tid)
    keys = [k for k in by_key if k]
    for ids in by_key.values():
        for other in ids[1:]:
            parent[find(other)] = find(ids[0])
    for i, ka in enumerate(keys):
        for kb in keys[i + 1:]:
            if _same_team_name(ka, kb):
                parent[find(by_key[kb][0])] = find(by_key[ka][0])
    return {tid: find(tid) for tid, _ in items}


_FILL_FIELDS = ("date_of_birth", "country", "nationality", "height_cm", "weight_kg", "preferred_foot")


def _display(p: Any) -> Optional[str]:
    return getattr(p, "display_name", None) or " ".join(
        x for x in (getattr(p, "first_name", None), getattr(p, "last_name", None)) if x) or None


def fill_from_duplicates(player: Any, others: Iterable[Any]) -> None:
    """Completa ``player`` (só em memória) com o que as linhas duplicadas têm: posição mais específica,
    nome mais completo e dados pessoais que faltam. Chame dentro de ``db.no_autoflush``."""
    others = [o for o in others if o is not None and o is not player]
    if not others:
        return
    player.position = best_position([player.position] + [o.position for o in others]) or player.position
    name = longest_name([_display(player)] + [_display(o) for o in others])
    if name:
        player.display_name = name
    for attr in _FILL_FIELDS:
        if getattr(player, attr, None) in (None, ""):
            for o in others:
                value = getattr(o, attr, None)
                if value not in (None, ""):
                    setattr(player, attr, value)
                    break


# --------------------------------------------------------------------------- banco + cache
_lock = threading.Lock()
_cache: Dict[str, Any] = {"at": 0.0, "key": None, "index": DuplicateIndex()}


def reset_cache() -> None:
    with _lock:
        _cache.update(at=0.0, key=None, index=DuplicateIndex())


def _fingerprint(db: Any) -> Tuple[Any, ...]:
    """Muda quando jogadores/times são criados ou alterados (e entre bancos diferentes, ex.: testes)."""
    from sqlalchemy import func, select

    from app.db.models import Player, Team

    try:
        url = str(db.get_bind().url)
    except Exception:  # noqa: BLE001
        url = ""
    pl = db.execute(select(func.count(Player.id), func.max(Player.id), func.max(Player.created_at))).one()
    tm = db.execute(select(func.count(Team.id), func.max(Team.id), func.max(Team.created_at))).one()
    return (url, *tuple(pl), *tuple(tm))


def _build(db: Any) -> DuplicateIndex:
    from sqlalchemy import select

    from app.db.models import Player, PlayerStatistics, Team

    groups = team_groups(db.execute(select(Team.id, Team.name)).all())
    size: Dict[int, int] = {}
    for g in groups.values():
        size[g] = size.get(g, 0) + 1
    multi = {tid for tid, g in groups.items() if size[g] > 1}     # só clubes com cadastro em 2+ fontes
    if not multi:
        return DuplicateIndex()

    stat_rows: Dict[int, Tuple[int, Tuple[int, int, int, int], float]] = {}
    for pid, season, games, mins, goals, assists, shots, xg in db.execute(
        select(PlayerStatistics.player_id, PlayerStatistics.season_id, PlayerStatistics.matches_played,
               PlayerStatistics.minutes_played, PlayerStatistics.goals, PlayerStatistics.assists,
               PlayerStatistics.shots, PlayerStatistics.xg_total)
        .where(PlayerStatistics.scope == "overall")
    ).all():
        prev = stat_rows.get(pid)
        if prev is None or (season or 0) >= prev[0]:
            rich = float(xg or 0) * 100 + float(shots or 0) + float(mins or 0) / 90
            stat_rows[pid] = (season or 0, (int(games or 0), int(mins or 0), int(goals or 0), int(assists or 0)), rich)

    rows: List[PRow] = []
    for p in db.execute(
        select(Player.id, Player.team_id, Player.display_name, Player.first_name, Player.last_name,
               Player.position, Player.date_of_birth).where(Player.team_id.in_(multi))
    ).all():
        name = p.display_name or " ".join(x for x in (p.first_name, p.last_name) if x)
        st = stat_rows.get(p.id)
        rows.append(PRow(p.id, p.team_id, name, p.position, p.date_of_birth,
                         st[1] if st else None, st[2] if st else 0.0))
    return group_players(rows, groups)


def duplicate_index(db: Any, ttl: float = _TTL) -> DuplicateIndex:
    now = time.monotonic()
    try:
        key = _fingerprint(db)
    except Exception:  # noqa: BLE001
        key = None
    with _lock:
        if key is not None and _cache["key"] == key and _cache["at"] and now - _cache["at"] < ttl:
            return _cache["index"]
    try:
        index = _build(db)
    except Exception:  # noqa: BLE001 — sem o agrupamento a lista só volta a mostrar repetidos
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return DuplicateIndex()
    with _lock:
        _cache.update(at=now, key=key, index=index)
    return index
