"""Comparação de jogadores com os **mesmos índices e métricas da tela do jogador** (nada novo).

* **Atacantes e meias** — índice ofensivo ScoutVision, a mesma fórmula de ``Player.tsx``: cinco
  componentes (Finalização, Criação, Produção, Construção, Regularidade) = média das métricas por
  90 min normalizadas por máximos típicos (``norm``), com pesos por função (meia pesa mais criação
  e construção). Média da liga vem de ``player_profile.league_averages``.
* **Defensores e goleiros** — o próprio ``index_service.player_index_payload`` (índice defensivo /
  de goleiro, notas por percentil entre os pares da liga), só que para a temporada escolhida.

Só se comparam jogadores da mesma família (ofensivo, defensor, goleiro), porque cada índice tem
componentes diferentes. A busca de substitutos compara o perfil dos componentes do índice da função.

Parte **pura** (``offense_rating``, ``compare_summary``, ``family_of``) e parte de banco
(``build_comparison``, ``find_similar``), cujas importações do banco ficam dentro das funções.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.services import stats_math as sm

MAX_PLAYERS = 4
POOL_MIN_MINUTES = 450          # mesmo corte de index_service.PEER_MIN_MINUTES
STRONG, WEAK = 70.0, 30.0       # nota que vira "destaque" / "ponto fraco"
TIE_GAP = 3.0                   # diferença menor que isso = empate técnico

ROLE_LABELS = {"GK": "Goleiro", "DEF": "Defensor", "MID": "Meio-campista", "ATT": "Atacante"}
FAMILY_OF_ROLE = {"ATT": "OFF", "MID": "OFF", "DEF": "DEF", "GK": "GK"}
FAMILY_LABEL = {"OFF": "Ofensivo (atacante e meia)", "DEF": "Defensor", "GK": "Goleiro"}
INDEX_NAME = {"OFF": "Índice ofensivo ScoutVision", "DEF": "Índice defensivo ScoutVision", "GK": "Índice de goleiro ScoutVision"}


def family_of(role: Optional[str]) -> Optional[str]:
    return FAMILY_OF_ROLE.get(role) if role else None


# --------------------------------------------------------------------------- índice ofensivo (espelha Player.tsx)
def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return min(hi, max(lo, v))


def _norm(v: Optional[float], max_value: float) -> float:
    """Igual ao ``norm`` de Player.tsx: valor / máximo típico, em 0–100."""
    return _clamp(((v or 0.0) / max_value) * 100.0)


# (componente, rótulo, dica, peso atacante, peso meia, métricas: (chave, rótulo, unidade, máximo típico, casas))
OFFENSE_PARTS: Tuple[Tuple[str, str, str, float, float, Tuple[Tuple[str, str, str, float, int], ...]], ...] = (
    ("fin", "Finalização", "Volume e qualidade dos chutes", 0.30, 0.15,
     (("shots_per_90", "Chutes / 90", "", 4.0, 2), ("npxg_per_90", "xG sem pênaltis / 90", "", 0.7, 2))),
    ("cre", "Criação", "Assistência esperada, passes-chave e xGChain", 0.25, 0.30,
     (("xa_per_90", "xA / 90", "", 0.4, 2), ("key_passes_per_90", "Passes-chave / 90", "", 2.5, 2),
      ("xg_chain_per_90", "xGChain / 90", "", 1.0, 2))),
    ("pro", "Produção", "Gols e assistências", 0.25, 0.15,
     (("goals_per_90", "Gols / 90", "", 0.7, 2), ("assists_per_90", "Assistências / 90", "", 0.4, 2))),
    ("con", "Construção", "Participação na construção das jogadas", 0.10, 0.25,
     (("xg_buildup_per_90", "xGBuildup / 90", "", 0.8, 2),)),
    ("reg", "Regularidade", "Minutos por jogo em que entra", 0.10, 0.15,
     (("minutes_share", "Minutos / jogos", "%", 100.0, 0),)),
)


def offense_values(stat: Any, extras: Mapping[str, float]) -> Dict[str, float]:
    """Métricas por 90 do índice ofensivo para uma linha de ``PlayerStatistics`` + extras do Understat."""
    matches, minutes = float(stat.matches_played or 0), float(stat.minutes_played or 0)
    return {
        "shots_per_90": float(stat.shots_per_90 or 0),
        "npxg_per_90": float(extras.get("npxg_per_90") or stat.xg_per_90 or 0),
        "xa_per_90": float(stat.xa_per_90 or 0),
        "key_passes_per_90": float(stat.key_passes_per_90 or 0),
        "xg_chain_per_90": float(extras.get("xg_chain_per_90") or 0),
        "goals_per_90": float(stat.goals_per_90 or 0),
        "assists_per_90": float(stat.assists_per_90 or 0),
        "xg_buildup_per_90": float(extras.get("xg_buildup_per_90") or 0),
        "minutes_share": _clamp(minutes / max(1.0, matches * 90.0) * 100.0),
    }


def _part_score(values: Mapping[str, float], metrics: Sequence[Tuple[str, str, str, float, int]]) -> float:
    return sum(_norm(values.get(k), mx) for k, _, _, mx, _ in metrics) / len(metrics)


def offense_rating(values: Mapping[str, float], role: Optional[str],
                   league: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Componentes (0–100) e índice ofensivo; ``league`` = médias por 90 da liga para mostrar ao lado."""
    league_vals: Optional[Dict[str, Any]] = None
    if league:
        league_vals = {**league, "npxg_per_90": league.get("npxg_per_90") or league.get("xg_per_90"), "minutes_share": None}
    axes: List[Dict[str, Any]] = []
    overall = 0.0
    for key, label, hint, w_att, w_mid, metrics in OFFENSE_PARTS:
        weight = w_mid if role == "MID" else w_att
        score = _part_score(values, metrics)
        overall += score * weight
        axes.append({
            "key": key, "label": label, "hint": hint, "weight": weight, "score": round(score, 1),
            "metrics": [{
                "key": k, "label": lbl, "unit": unit, "score": round(_norm(values.get(k), mx), 1),
                "value": round(values.get(k, 0.0), dec),
                "league_avg": None if not league_vals or league_vals.get(k) is None else round(float(league_vals[k]), dec),
            } for k, lbl, unit, mx, dec in metrics],
        })
    return {"axes": axes, "overall": int(round(overall))}


def offense_vector(values: Mapping[str, float]) -> List[float]:
    return [_part_score(values, m) for *_, m in OFFENSE_PARTS]


# --------------------------------------------------------------------------- resumo comparativo (puro)
def highlights(axes: Sequence[Mapping[str, Any]]) -> Tuple[List[str], List[str]]:
    scored = [a for a in axes if a.get("score") is not None]
    strengths = [f"{a['label']} ({int(round(a['score']))})" for a in sorted(
        (a for a in scored if a["score"] >= STRONG), key=lambda a: a["score"], reverse=True)[:2]]
    weaknesses = [f"{a['label']} ({int(round(a['score']))})" for a in sorted(
        (a for a in scored if a["score"] <= WEAK), key=lambda a: a["score"])[:2]]
    return strengths, weaknesses


def compare_summary(players: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Quem lidera cada componente e o texto do resumo (só jogadores com índice)."""
    ready = [p for p in players if p.get("available") and p.get("axes")]
    leaders: List[Dict[str, Any]] = []
    wins: Dict[int, int] = {}
    if len(ready) >= 2:
        for i, axis in enumerate(ready[0]["axes"]):
            scored = [(p["axes"][i]["score"], p) for p in ready
                      if i < len(p["axes"]) and p["axes"][i]["score"] is not None]
            if len(scored) < 2:
                continue
            scored.sort(key=lambda t: t[0], reverse=True)
            gap = scored[0][0] - scored[1][0]
            tie = gap < TIE_GAP
            leaders.append({"axis": axis["key"], "label": axis["label"],
                            "player_id": None if tie else scored[0][1]["player_id"],
                            "name": None if tie else scored[0][1]["name"], "gap": round(gap, 1)})
            if not tie:
                pid = scored[0][1]["player_id"]
                wins[pid] = wins.get(pid, 0) + 1
    lines: List[str] = []
    if leaders:
        by_id = {p["player_id"]: p for p in ready}
        for pid, count in sorted(wins.items(), key=lambda kv: kv[1], reverse=True):
            labels = [l["label"].lower() for l in leaders if l["player_id"] == pid][:3]
            lines.append(f"{by_id[pid]['name']} lidera {count} de {len(leaders)} componentes ({', '.join(labels)}).")
        ties = [l["label"].lower() for l in leaders if l["player_id"] is None]
        if ties:
            lines.append(f"Empate técnico (diferença < {int(TIE_GAP)} pontos) em: {', '.join(ties)}.")
        overall = sorted(((p["overall"], p) for p in ready if p.get("overall") is not None), key=lambda t: t[0], reverse=True)
        if len(overall) >= 2:
            lines.append(f"{ready[0].get('index_name', 'Índice')}: {overall[0][1]['name']} {overall[0][0]} "
                         f"vs {overall[1][1]['name']} {overall[1][0]}.")
    return {"leaders": leaders, "lines": lines}


def has_understat(stat: Any) -> bool:
    """A linha tem as métricas do Understat (chutes, xG, xA, passes-chave, xGChain)? Sem elas o índice ofensivo
    sairia zerado, o que parece \"jogador ruim\" mas é só dado faltando."""
    if any(getattr(stat, k, None) for k in ("shots_per_90", "xg_per_90", "xa_per_90", "key_passes_per_90", "xg_total", "shots")):
        return True
    rf = getattr(stat, "recent_form", None)
    return isinstance(rf, dict) and any(rf.get(k) for k in ("xg_chain", "xg_buildup", "npxg"))


def stat_richness(stat: Any) -> int:
    """Quantas fontes de dados a linha tem (Understat por 90, xG, forma recente, estatísticas extras)."""
    checks = (
        getattr(stat, "shots_per_90", None), getattr(stat, "xg_per_90", None), getattr(stat, "xa_per_90", None),
        getattr(stat, "key_passes_per_90", None), getattr(stat, "xg_total", None), getattr(stat, "shots", None),
        getattr(stat, "recent_form", None), getattr(stat, "supplemental_stats", None),
    )
    return sum(1 for v in checks if v)


def stat_priority(stat: Any) -> Tuple[int, int, float]:
    """Jogadores duplicados entre fontes têm uma linha do football-data (mais minutos, sem chutes/xG) e outra do
    Understat: vale a que tem as métricas (como a tela do jogador), depois a mais completa, depois a de mais minutos."""
    return (1 if has_understat(stat) else 0, stat_richness(stat), float(getattr(stat, "minutes_played", 0) or 0))


def season_label(name: Optional[str]) -> str:
    """\"2025\" (Understat) → \"2025/26\"."""
    if name and name.isdigit() and len(name) == 4:
        return f"{name}/{str(int(name) + 1)[-2:]}"
    return name or "—"


def _age(dob: Optional[date]) -> Optional[int]:
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


# --------------------------------------------------------------------------- banco
def _top5_codes() -> Tuple[str, ...]:
    from app.services.player_profile import TOP5_CODES
    return TOP5_CODES


def _load_bundle(db: Any, player_id: int, season_id: Optional[int]) -> Optional[Dict[str, Any]]:
    """Jogador (unido às cópias de outras fontes), temporadas com minutos e a linha de estatística escolhida."""
    from sqlalchemy import select
    from app.db.models import Competition, Player, PlayerStatistics, Season
    from app.services.player_dedupe import duplicate_index, fill_from_duplicates
    from app.services.player_profile import LEAGUE_LABELS, decorate_players

    index = duplicate_index(db)
    canon = index.canonical_of.get(player_id, player_id)
    member_ids = sorted(set(index.members.get(canon, [])) | {player_id, canon})
    players = {p.id: p for p in db.scalars(select(Player).where(Player.id.in_(member_ids))).all()}
    if not players:
        return None
    primary = players.get(player_id) or players.get(canon) or next(iter(players.values()))
    with db.no_autoflush:
        fill_from_duplicates(primary, [p for i, p in players.items() if i != primary.id])
        decorate_players(db, [primary])

    rows = db.execute(
        select(PlayerStatistics, Season, Competition)
        .join(Season, Season.id == PlayerStatistics.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(PlayerStatistics.player_id.in_(member_ids), PlayerStatistics.scope == "overall",
               PlayerStatistics.minutes_played > 0, Competition.code.in_(_top5_codes()))
    ).all()
    # Uma entrada por (nome da temporada, liga): fontes diferentes podem ter linhas de temporada distintas
    # para o mesmo ano; fica a que tem as métricas.
    groups: Dict[Tuple[str, str], Tuple[Any, Any, Any]] = {}
    group_of_season: Dict[int, Tuple[str, str]] = {}
    for stat, season, comp in rows:
        key = (season.name or str(season.id), comp.code)
        group_of_season[season.id] = key
        cur = groups.get(key)
        if cur is None or stat_priority(stat) > stat_priority(cur[0]):
            groups[key] = (stat, season, comp)
    ordered = sorted(groups.values(), key=lambda t: (t[1].name or "", t[1].id), reverse=True)
    seasons = [{
        "id": s.id, "name": s.name, "label": season_label(s.name), "league_code": c.code,
        "league_name": LEAGUE_LABELS.get(c.code, c.name), "minutes": st.minutes_played, "matches": st.matches_played,
    } for st, s, c in ordered]
    chosen = groups.get(group_of_season.get(season_id)) if season_id is not None else None
    if chosen is None and ordered:
        chosen = ordered[0]
    return {"player": primary, "seasons": seasons, "chosen": chosen}


def _identity(bundle: Dict[str, Any], role: Optional[str]) -> Dict[str, Any]:
    from app.services.player_profile import LEAGUE_LABELS

    p = bundle["player"]
    stat, season, comp = bundle["chosen"]
    return {
        "player_id": p.id,
        "name": p.display_name or " ".join(x for x in (p.first_name, p.last_name) if x) or p.last_name,
        "position": p.position, "role": role, "role_label": ROLE_LABELS.get(role) if role else None,
        "age": _age(p.date_of_birth), "country": p.country,
        "team": {"id": p.team_id, "name": getattr(p, "team_name", None), "logo_url": getattr(p, "team_logo_url", None)},
        "league": {"code": comp.code, "name": LEAGUE_LABELS.get(comp.code, comp.name)},
        "season": {"id": season.id, "name": season.name, "label": season_label(season.name)},
        "seasons": bundle["seasons"], "minutes": stat.minutes_played, "matches": stat.matches_played,
        "goals": stat.goals, "assists": stat.assists,
    }


def build_comparison(db: Any, entries: Sequence[Tuple[int, Optional[int]]], template: str = "auto") -> Dict[str, Any]:
    """Compara até ``MAX_PLAYERS`` jogadores. ``entries``: ``(player_id, season_id | None)``.

    ``template``: ``auto`` (função do 1º jogador) ou ``ATT``/``MID``/``DEF``/``GK``.
    """
    from app.services.index_service import player_index_payload, role_of
    from app.services.player_profile import extras_from_stat, league_averages, team_league_map

    wanted = None if template.lower() == "auto" else template.upper()
    if wanted is not None and wanted not in FAMILY_OF_ROLE:
        raise ValueError(f"Template inválido: {template}. Válidos: auto, {', '.join(FAMILY_OF_ROLE)}")

    bundles = [_load_bundle(db, pid, sid) for pid, sid in entries[:MAX_PLAYERS]]
    roles: List[Optional[str]] = []
    for b in bundles:
        roles.append(role_of(b["player"].position, b["chosen"][0]) if b and b["chosen"] else None)
    family = FAMILY_OF_ROLE.get(wanted) if wanted else next((family_of(r) for r in roles if r), None)
    if family is None:
        return {"available": False, "reason": "Posição dos jogadores desconhecida ou sem estatísticas nas 5 ligas.",
                "players": [], "template": None}

    league_map = team_league_map(db)
    avg_cache: Dict[Optional[str], Any] = {}
    players: List[Dict[str, Any]] = []
    for (pid, _), bundle, role in zip(entries, bundles, roles):
        if bundle is None:
            players.append({"available": False, "player_id": pid, "name": f"Jogador {pid}", "reason": "Jogador não encontrado."})
            continue
        if bundle["chosen"] is None:
            p = bundle["player"]
            players.append({"available": False, "player_id": p.id, "name": p.display_name or p.last_name,
                            "reason": "Sem estatísticas com minutos nas 5 ligas.", "seasons": []})
            continue
        base = _identity(bundle, role)
        stat = bundle["chosen"][0]
        if family_of(role) != family:
            players.append({**base, "available": False,
                            "reason": f"Função diferente ({base['role_label'] or 'desconhecida'}): compare jogadores da mesma função."})
            continue
        if family == "OFF" and not has_understat(stat):
            players.append({**base, "available": False,
                            "reason": "Sem dados do Understat (chutes, xG, xA) nesta temporada: o índice ofensivo ficaria zerado. Escolha outra temporada ou outro jogador."})
            continue
        if family == "OFF":
            code = base["league"]["code"]
            if code not in avg_cache:
                avg_cache[code] = league_averages(db, code, league_map)
            rating = offense_rating(offense_values(stat, extras_from_stat(stat)), role, avg_cache[code])
            strengths, weaknesses = highlights(rating["axes"])
            n_league = (avg_cache[code] or {}).get("n_players", 0)
            players.append({**base, "available": True, "family": family, "index_name": INDEX_NAME[family],
                            "axes": rating["axes"], "overall": rating["overall"], "strengths": strengths,
                            "weaknesses": weaknesses,
                            "context": f"Média da liga: {base['league']['name']} ({n_league} jogadores de linha)"})
            continue
        payload = player_index_payload(db, bundle["player"], stat)
        if not payload.get("available"):
            players.append({**base, "available": False, "reason": payload.get("reason") or "Índice indisponível."})
            continue
        axes = [{
            "key": c["key"], "label": c["label"], "hint": c.get("hint", ""), "weight": c["weight"], "score": c["score"],
            "metrics": [{"key": m["key"], "label": m["label"], "unit": m["unit"], "value": m["value"],
                         "league_avg": m.get("league_avg"), "score": m.get("score"), "z": m.get("z")} for m in c["metrics"]],
        } for c in payload["components"]]
        strengths, weaknesses = highlights(axes)
        sample = payload.get("sample") or {}
        players.append({**base, "available": True, "family": family, "index_name": INDEX_NAME[family],
                        "axes": axes, "overall": payload["index"], "strengths": strengths, "weaknesses": weaknesses,
                        "reliability": payload.get("reliability"),
                        "context": f"Pares: {sample.get('peers', 0)} {ROLE_LABELS[role].lower()}s de {sample.get('league') or 'liga'} (≥ {POOL_MIN_MINUTES} min)"})

    ready = [p for p in players if p.get("available")]
    axes_def = [{"key": a["key"], "label": a["label"], "hint": a.get("hint", "")} for a in (ready[0]["axes"] if ready else [])]
    notes = [
        "Mesmos índices e métricas da tela do jogador: nada foi criado só para a comparação.",
        "Nota 0–100 de cada componente, como na tela do jogador; o valor da métrica aparece ao lado da média da liga.",
    ]
    if family == "OFF":
        notes.append("Índice ofensivo: média das métricas por 90 min normalizadas por máximos típicos; meias têm pesos diferentes de atacantes.")
    else:
        notes.append("Notas por percentil entre os pares da mesma função na liga (ou faixas típicas quando há poucos pares).")
    return {
        "available": True,
        "template": {"key": family, "label": FAMILY_LABEL[family], "axes": axes_def},
        "players": players, "comparison": compare_summary(players), "notes": notes,
    }


def index_vectors(role: str, peers: Sequence[Mapping[str, Any]], min_minutes: float = POOL_MIN_MINUTES
                  ) -> List[Tuple[Mapping[str, Any], List[Optional[float]]]]:
    """Nota de cada componente do índice defensivo/de goleiro para cada par (``flat`` com ``player_id``).

    Mesma conta do ``player_index_payload``: ``compute_metrics`` + ``score_index`` contra os pares da liga.
    """
    from app.services.position_index import compute_metrics, league_save_pct, reduce_peer_metrics, score_index

    lsp = league_save_pct(peers) if role == "GK" else None
    peer_metrics = reduce_peer_metrics(role, peers, min_minutes)
    out: List[Tuple[Mapping[str, Any], List[Optional[float]]]] = []
    for flat in peers:
        minutes = float(flat.get("minutes_played") or 0)
        if minutes < min_minutes:
            continue
        result = score_index(role, compute_metrics(role, flat, lsp), peer_metrics, minutes)
        out.append((flat, [c.get("score") for c in result.get("components", [])]))
    return out


def _rank_offense(db: Any, target: List[float], role: str, season: Any, scope: str, league: Optional[str],
                  canon_self: int, self_id: int) -> List[Tuple[float, Any, int, int, str, List[Optional[float]]]]:
    from sqlalchemy import select
    from app.db.models import Competition, Player, PlayerStatistics, Season
    from app.services.index_service import role_of
    from app.services.player_dedupe import duplicate_index
    from app.services.player_profile import extras_from_stat

    season_ids = [season.id]
    if scope == "top5":
        season_ids = list(db.scalars(
            select(Season.id).join(Competition, Competition.id == Season.competition_id)
            .where(Season.name == season.name, Competition.code.in_(_top5_codes()))).all()) or [season.id]
    rows = db.execute(
        select(PlayerStatistics, Player, Competition.code)
        .join(Player, Player.id == PlayerStatistics.player_id)
        .join(Season, Season.id == PlayerStatistics.season_id)
        .join(Competition, Competition.id == Season.competition_id)
        .where(PlayerStatistics.season_id.in_(season_ids), PlayerStatistics.scope == "overall",
               PlayerStatistics.minutes_played >= POOL_MIN_MINUTES, Competition.code.in_(_top5_codes()))
    ).all()
    canonical_of = duplicate_index(db).canonical_of
    best: Dict[int, Tuple[float, Any, int, int, str, List[Optional[float]]]] = {}
    for cstat, person, code in rows:
        canon = canonical_of.get(person.id, person.id)
        if canon == canon_self or person.id == self_id or (league and code != league.upper()):
            continue
        if role_of(person.position, cstat) != role or not has_understat(cstat):
            continue
        vec: List[Optional[float]] = list(offense_vector(offense_values(cstat, extras_from_stat(cstat))))
        sim = sm.profile_similarity(target, vec)
        if sim is not None and (canon not in best or sim > best[canon][0]):
            best[canon] = (sim, person, cstat.season_id, int(cstat.minutes_played or 0), code, vec)
    return sorted(best.values(), key=lambda t: t[0], reverse=True)


def _rank_index(db: Any, target: List[Optional[float]], role: str, season: Any, scope: str, league: Optional[str],
                own_code: str, canon_self: int, self_id: int) -> List[Tuple[float, Any, int, int, str, List[Optional[float]]]]:
    """Defensores/goleiros: cada candidato é pontuado contra os pares da PRÓPRIA liga (como na tela do jogador)."""
    from sqlalchemy import select
    from app.db.models import Competition, Player, Season
    from app.services.index_service import league_peers
    from app.services.player_dedupe import duplicate_index
    from app.services.player_profile import team_league_map

    codes = [own_code] if scope == "league" else list(_top5_codes())
    if league:
        codes = [c for c in codes if c == league.upper()]
    season_by_code = dict(db.execute(
        select(Competition.code, Season.id).join(Competition, Competition.id == Season.competition_id)
        .where(Season.name == season.name, Competition.code.in_(codes))).all())
    league_map = team_league_map(db)
    canonical_of = duplicate_index(db).canonical_of
    scored: List[Tuple[float, int, int, str, List[Optional[float]]]] = []
    for code, season_id in season_by_code.items():
        peers = league_peers(db, role, season_id, code, league_map)
        for flat, vec in index_vectors(role, peers):
            if flat["player_id"] == self_id or canonical_of.get(flat["player_id"], flat["player_id"]) == canon_self:
                continue
            sim = sm.profile_similarity(target, vec)
            if sim is not None:
                scored.append((sim, flat["player_id"], season_id, int(flat.get("minutes_played") or 0), code, vec))
    scored.sort(key=lambda t: t[0], reverse=True)
    people = {p.id: p for p in db.scalars(select(Player).where(Player.id.in_(list({t[1] for t in scored[:400]})))).all()}
    best: Dict[int, Tuple[float, Any, int, int, str, List[Optional[float]]]] = {}
    for sim, pid, sid, minutes, code, vec in scored:
        person = people.get(pid)
        canon = canonical_of.get(pid, pid)
        if person is not None and canon not in best:
            best[canon] = (sim, person, sid, minutes, code, vec)
    return sorted(best.values(), key=lambda t: t[0], reverse=True)


def find_similar(db: Any, player_id: int, season_id: Optional[int] = None, scope: str = "top5",
                 league: Optional[str] = None, limit: int = 8, max_age: Optional[int] = None) -> Dict[str, Any]:
    """Jogadores da mesma função com perfil mais parecido, nos componentes do índice da função.

    Atacantes/meias: índice ofensivo; defensores/goleiros: índice defensivo/de goleiro (notas contra os pares
    da liga de cada candidato).
    """
    from app.services.index_service import player_index_payload, role_of
    from app.services.player_dedupe import duplicate_index
    from app.services.player_profile import LEAGUE_LABELS, decorate_players, extras_from_stat

    bundle = _load_bundle(db, player_id, season_id)
    if bundle is None or bundle["chosen"] is None:
        return {"available": False, "reason": "Jogador sem estatísticas com minutos nas 5 ligas.", "items": []}
    stat, season, comp = bundle["chosen"]
    me = bundle["player"]
    role = role_of(me.position, stat)
    family = family_of(role)
    if family is None:
        return {"available": False, "items": [], "reason": "Posição do jogador desconhecida."}
    canon_self = duplicate_index(db).canonical_of.get(me.id, me.id)

    if family == "OFF":
        labels = [p[1] for p in OFFENSE_PARTS]
        target: List[Optional[float]] = list(offense_vector(offense_values(stat, extras_from_stat(stat))))
        ranked = _rank_offense(db, [float(v) for v in target if v is not None], role, season, scope, league, canon_self, me.id)
        notes_axes = "os 5 componentes do índice ofensivo (Finalização, Criação, Produção, Construção, Regularidade)"
    else:
        payload = player_index_payload(db, me, stat)
        if not payload.get("available"):
            return {"available": False, "items": [], "reason": payload.get("reason") or "Índice do jogador indisponível."}
        labels = [c["label"] for c in payload["components"]]
        target = [c["score"] for c in payload["components"]]
        ranked = _rank_index(db, target, role, season, scope, league, comp.code, canon_self, me.id)
        notes_axes = "os componentes do " + INDEX_NAME[family].lower() + " (" + ", ".join(labels) + ")"

    people = [t[1] for t in ranked[: max(limit * 6, 40)]]
    with db.no_autoflush:
        decorate_players(db, people)
    items: List[Dict[str, Any]] = []
    for sim, person, sid, minutes, code, vec in ranked:
        age = _age(person.date_of_birth)
        if max_age is not None and (age is None or age > max_age):
            continue
        gaps = sorted(((labels[i], vec[i] - target[i]) for i in range(len(labels))
                       if vec[i] is not None and target[i] is not None), key=lambda t: t[1])
        items.append({
            "player_id": person.id,
            "name": person.display_name or " ".join(x for x in (person.first_name, person.last_name) if x) or person.last_name,
            "position": person.position, "age": age,
            "team": {"id": person.team_id, "name": getattr(person, "team_name", None), "logo_url": getattr(person, "team_logo_url", None)},
            "league": {"code": code, "name": LEAGUE_LABELS.get(code, code)},
            "season_id": sid, "minutes": minutes, "similarity": round(sim, 1),
            "better_at": [g[0] for g in reversed(gaps[-2:]) if g[1] >= 8],
            "worse_at": [g[0] for g in gaps[:2] if g[1] <= -8],
        })
        if len(items) >= limit:
            break
    notes = [f"Similaridade = 100 − distância média entre {notes_axes}.",
             f"Só entram jogadores da mesma função com ≥ {POOL_MIN_MINUTES} min na temporada."]
    if family != "OFF":
        notes.append("Cada candidato é pontuado contra os pares da própria liga, como na tela do jogador.")
    return {
        "available": True, "player_id": me.id, "role": role, "role_label": ROLE_LABELS[role], "scope": scope,
        "season": {"id": season.id, "label": season_label(season.name)}, "pool_size": len(ranked), "items": items,
        "notes": notes,
    }
