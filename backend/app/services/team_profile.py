"""Perfil de um time calculado AO VIVO a partir dos chutes reais (Understat).

A página de um time usa ids de qualquer fonte (football-data, Understat...). O football-data
não traz xG nem chutes, então esta função procura os "times irmãos" (mesmo nome normalizado)
em todas as fontes e agrega o que existir:

* resumo da temporada (xG/xGA por 90, chutes por 90, gols, saldo de xG);
* jogo a jogo (xG a favor/contra, resultado) — alimenta o gráfico de forma;
* fraqueza defensiva por zona (xG concedido contra a média da liga) — o mesmo cálculo da
  tela de Análise, só que para a temporada inteira do time, sem depender de um adversário;
* força ofensiva por zona e as "oportunidades" por jogador (onde cada um finaliza);
* jogadores com jogos, gols e xG (Understat), ligados ao elenco do football-data.

Nada é inventado: sem chutes para o time, ``available`` vem ``False`` e a tela mostra "—".
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    Competition, DataSource, Match, Player, PlayerStatistics, Season, Team, TeamStatistics,
)
from app.services.crests import resolve_crest
from app.services.shot_insights import (
    TOP_PLAYERS, ZONE_LABEL_PT, _attack_profile, _defense_profile, _player_rows, _xg,
    clamp, season_baseline,
)
from app.services.studio import (
    _load_shot_events, _player_name, _recent_match_ids, _same_person, _team_ids_like, norm_person,
)

SEASON_WINDOW = 60  # teto de jogos da temporada considerados (uma liga tem no máximo 38)


def _group_of(position: Optional[str]) -> str:
    """Linha do jogador a partir da posição (Understat: 'GK', 'D', 'M S', 'F'...; football-data: 'Defence'...)."""
    token = (position or "").strip().upper().split(" ")[0] if position else ""
    if token in {"GK", "G"} or token.startswith("GOAL"):
        return "gk"
    if token in {"D"} or token.startswith("DEF"):
        return "def"
    if token in {"M"} or token.startswith("MID"):
        return "mid"
    return "att"


def _match_fd_player(name: str, candidates: List[Player]) -> Optional[int]:
    """Id do jogador do football-data equivalente ao nome do Understat (nome igual > sobrenome+inicial)."""
    key = norm_person(name)
    if not key:
        return None
    for p in candidates:
        if norm_person(_player_name(p)) == key:
            return p.id
    for p in candidates:
        if _same_person(key, norm_person(_player_name(p))):
            return p.id
    return None


def _players_block(
    db: Session, team_ids: List[int], season_id: Optional[int], events: List[Any], tset: set, n_matches: int,
) -> List[Dict[str, Any]]:
    understat_ids = [
        t.id for t in db.scalars(
            select(Team).where(Team.id.in_(team_ids), Team.data_source == DataSource.UNDERSTAT)
        ).all()
    ]
    other_ids = [i for i in team_ids if i not in understat_ids]
    fd_players = list(db.scalars(select(Player).where(Player.team_id.in_(other_ids))).all()) if other_ids else []

    rows: List[Dict[str, Any]] = []
    if understat_ids and season_id is not None:
        for player, st in db.execute(
            select(Player, PlayerStatistics)
            .join(PlayerStatistics, PlayerStatistics.player_id == Player.id)
            .where(
                Player.team_id.in_(understat_ids),
                PlayerStatistics.season_id == season_id,
                PlayerStatistics.scope == "overall",
            )
        ).all():
            name = _player_name(player) or f"Jogador {player.id}"
            position = (st.recent_form or {}).get("position") or player.position
            rows.append({
                "player_id": player.id,
                "fd_player_id": _match_fd_player(name, fd_players),
                "name": name,
                "position": position,
                "group": _group_of(position),
                "games": int(st.matches_played or 0),
                "minutes": int(st.minutes_played or 0),
                "goals": int(st.goals or 0),
                "assists": int(st.assists or 0),
                "shots": int(st.shots or 0),
                "key_passes": int(st.key_passes or 0),
                "xg": round(float(st.xg_total or 0), 2),
                "xa": round(float(st.xa_total or 0), 2),
                "xg_per_90": round(float(st.xg_per_90 or 0), 2),
                "goals_per_90": round(float(st.goals_per_90 or 0), 2),
                "source": "understat",
            })
    if rows:
        return sorted(rows, key=lambda r: (r["goals"], r["xg"], r["minutes"]), reverse=True)

    # Sem tabela de jogadores: reconstrói só com quem finalizou (jogos = jogos em que chutou).
    games_by: Dict[int, set] = defaultdict(set)
    for e in events:
        if e.team_id in tset and e.player_id is not None:
            games_by[e.player_id].add(e.match_id)
    out = []
    for p in _player_rows(events, tset, n_matches).values():
        n_games = len(games_by.get(p["player_id"], ())) or 0
        out.append({
            "player_id": p["player_id"],
            "fd_player_id": _match_fd_player(p["name"], fd_players),
            "name": p["name"], "position": None, "group": "att",
            "games": n_games, "minutes": None,
            "goals": p["goals"], "assists": p["assists"], "shots": p["shots"], "key_passes": None,
            "xg": round(p["xg"], 2), "xa": None, "xg_per_90": None, "goals_per_90": None,
            "source": "shots",
        })
    return sorted(out, key=lambda r: (r["goals"], r["xg"]), reverse=True)


def _squad_block(
    db: Session, team_ids: List[int], understat_players: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Elenco completo: jogadores cadastrados de todas as fontes + estatísticas da Understat quando o nome bate.

    A página pode ser aberta pelo id da Understat (que só tem quem jogou) ou do football-data
    (elenco inteiro, sem estatística): aqui os dois viram uma lista só, sem duplicar ninguém.
    """
    us_ids = {
        t.id for t in db.scalars(
            select(Team).where(Team.id.in_(team_ids), Team.data_source == DataSource.UNDERSTAT)
        ).all()
    }
    registered = db.scalars(
        select(Player).where(Player.team_id.in_(team_ids)).order_by(Player.id)
    ).all()
    by_fd_id = {u["fd_player_id"]: u for u in understat_players if u["fd_player_id"] is not None}

    out: List[Dict[str, Any]] = []
    seen: set = set()
    for p in registered:
        if p.team_id in us_ids:
            continue  # jogadores da Understat entram abaixo, já com estatística
        name = _player_name(p) or f"Jogador {p.id}"
        key = norm_person(name)
        if key in seen:
            continue
        seen.add(key)
        u = by_fd_id.get(p.id)
        position = p.position or (u or {}).get("position")
        out.append({
            "key": f"fd-{p.id}", "name": name, "position": position,
            "born": p.date_of_birth.year if p.date_of_birth else None,
            "group": _group_of(p.position) if p.position else (u or {}).get("group", "att"),
            "games": u["games"] if u else None, "goals": u["goals"] if u else None,
            "assists": u["assists"] if u else None, "xg": u["xg"] if u else None,
            "has_stats": u is not None,
        })
    matched = {u["player_id"] for u in by_fd_id.values()}
    for u in understat_players:
        if u["player_id"] in matched or norm_person(u["name"]) in seen:
            continue
        seen.add(norm_person(u["name"]))
        out.append({
            "key": f"us-{u['player_id']}", "name": u["name"], "position": u["position"], "born": None,
            "group": u["group"], "games": u["games"], "goals": u["goals"],
            "assists": u["assists"], "xg": u["xg"], "has_stats": True,
        })
    return out


def _standings_block(db: Session, season_id: Optional[int]) -> List[Dict[str, Any]]:
    """Classificação da temporada a partir da tabela da Understat (para times sem tabela no football-data)."""
    if season_id is None:
        return []
    rows = db.execute(
        select(TeamStatistics, Team)
        .join(Team, Team.id == TeamStatistics.team_id)
        .where(TeamStatistics.season_id == season_id, TeamStatistics.scope == "overall")
    ).all()
    table = []
    for st, t in rows:
        won, draw, lost = int(st.wins or 0), int(st.draws or 0), int(st.losses or 0)
        gf, ga = int(st.goals_for or 0), int(st.goals_against or 0)
        table.append({
            "team_id": t.id, "team_name": t.name, "team_logo": resolve_crest(t.name, t.logo_url),
            "team_code": t.short_name, "group_name": "", "played": int(st.matches_played or 0),
            "won": won, "draw": draw, "lost": lost, "points": won * 3 + draw,
            "goals_for": gf, "goals_against": ga, "goal_difference": gf - ga,
        })
    table.sort(key=lambda r: (r["points"], r["goal_difference"], r["goals_for"]), reverse=True)
    for i, r in enumerate(table, start=1):
        r["position"] = i
    return table


def _opportunities(events: List[Any], tset: set, n_matches: int) -> List[Dict[str, Any]]:
    """Onde cada jogador do time gera perigo (zonas de ataque). Sem adversário: só força × frequência."""
    n = max(1, n_matches)
    ranked = sorted(
        _player_rows(events, tset, n_matches).values(),
        key=lambda p: (p["xg"] + 0.3 * p["shots"]), reverse=True,
    )[:TOP_PLAYERS]
    out: List[Dict[str, Any]] = []
    for p in ranked:
        total_shots = max(1, p["shots"])
        for zone, z in p["zones"].items():
            if zone not in ZONE_LABEL_PT:
                continue
            freq = z["n"] / total_shots
            off = clamp((z["xg"] / n) / 0.4)
            score = off * (0.4 + 0.6 * freq)
            if zone in ("central_box", "outside_box_central"):
                score *= 1.25
            out.append({
                "zone": zone, "opportunity_score": round(score, 5),
                "player_id": p["player_id"], "player_name": p["name"],
                "offensive_strength": round(off, 4), "player_frequency": round(freq, 4),
                "shots": z["n"], "xg": round(z["xg"], 3),
            })
    return out


def team_profile(db: Session, team: Team, season_id: Optional[int] = None) -> Dict[str, Any]:
    team_ids = _team_ids_like(db, team)
    base: Dict[str, Any] = {
        "available": False,
        "team": {"id": team.id, "name": team.name, "logo_url": resolve_crest(team.name, team.logo_url)},
        "team_ids": team_ids,
        "method": "team-zone-profile@1",
    }
    horizon = datetime.utcnow() + timedelta(days=2)
    candidate_ids = _recent_match_ids(db, team_ids, horizon, SEASON_WINDOW)
    if not candidate_ids:
        return {**base, "players": [], "notes": ["Ainda não há chutes reais importados para este time."]}

    matches = list(db.scalars(
        select(Match)
        .options(selectinload(Match.home_team), selectinload(Match.away_team))
        .where(Match.id.in_(candidate_ids))
        .order_by(Match.kickoff_time.desc())
    ).all())
    if season_id is None:
        season_id = matches[0].season_id
    matches = [m for m in matches if m.season_id == season_id]
    chronological = sorted(matches, key=lambda m: (m.kickoff_time, m.id))
    match_ids = [m.id for m in chronological]
    n = len(match_ids)
    tset = set(team_ids)

    events = _load_shot_events(db, match_ids)
    att_base, def_base, league_n = season_baseline(db, season_id, horizon, events)
    weaknesses = _defense_profile(events, tset, match_ids, def_base)
    attack = _attack_profile(events, tset, match_ids, att_base)

    per_match: Dict[int, Dict[str, float]] = defaultdict(lambda: {"xf": 0.0, "xa": 0.0, "sf": 0, "sa": 0})
    for e in events:
        bucket = per_match[e.match_id]
        if e.team_id in tset:
            bucket["xf"] += _xg(e)
            bucket["sf"] += 1
        else:
            bucket["xa"] += _xg(e)
            bucket["sa"] += 1

    rows: List[Dict[str, Any]] = []
    wins = draws = losses = 0
    goals_for = goals_against = 0
    scored_games = 0
    for m in chronological:
        home = m.home_team_id in tset
        opp = m.away_team if home else m.home_team
        gf = m.home_score if home else m.away_score
        ga = m.away_score if home else m.home_score
        result = None
        if gf is not None and ga is not None:
            result = "W" if gf > ga else ("D" if gf == ga else "L")
            wins += result == "W"
            draws += result == "D"
            losses += result == "L"
            goals_for += gf
            goals_against += ga
            scored_games += 1
        b = per_match[m.id]
        rows.append({
            "match_id": m.id,
            "kickoff_time": m.kickoff_time.isoformat() if m.kickoff_time else None,
            "home": home,
            "opponent": opp.name if opp else None,
            "opponent_logo": resolve_crest(opp.name, opp.logo_url) if opp else None,
            "goals_for": gf, "goals_against": ga, "result": result,
            "xg_for": round(b["xf"], 2), "xg_against": round(b["xa"], 2),
            "shots_for": int(b["sf"]), "shots_against": int(b["sa"]),
        })

    xg_for = sum(r["xg_for"] for r in rows)
    xg_against = sum(r["xg_against"] for r in rows)
    shots_for = sum(r["shots_for"] for r in rows)
    shots_against = sum(r["shots_against"] for r in rows)

    def per90(total: float, games: int) -> Optional[float]:
        return round(total / games, 2) if games else None

    players = _players_block(db, team_ids, season_id, events, tset, n)
    season_row = db.get(Season, season_id) if season_id is not None else None
    comp = db.get(Competition, season_row.competition_id) if season_row else None

    return {
        **base,
        "available": True,
        "season": {
            "id": season_id, "name": season_row.name if season_row else None,
            "competition": comp.name if comp else None, "code": comp.code if comp else None,
        },
        "sample": {"matches": n, "league_matches": league_n},
        "summary": {
            "matches": n, "wins": wins, "draws": draws, "losses": losses,
            "goals_for": goals_for, "goals_against": goals_against,
            "xg_for": round(xg_for, 2), "xg_against": round(xg_against, 2),
            "xg_per_90": per90(xg_for, n), "xga_per_90": per90(xg_against, n),
            "xg_diff_per_90": per90(xg_for - xg_against, n),
            "shots_per_90": per90(shots_for, n), "shots_against_per_90": per90(shots_against, n),
            "goals_per_90": per90(goals_for, scored_games),
            "goals_conceded_per_90": per90(goals_against, scored_games),
            "goals_minus_xg": round(goals_for - xg_for, 2) if scored_games else None,
        },
        "matches": rows,
        "weaknesses": weaknesses,
        "attack": attack,
        "opportunities": _opportunities(events, tset, n),
        "players": players,
        "squad": _squad_block(db, team_ids, players),
        "standings": _standings_block(db, season_id),
        "notes": [
            f"Baseado nos {n} jogos da temporada com chutes reais (Understat), "
            f"comparados à média de {league_n} jogos da liga.",
            "Fraqueza = xG concedido em cada zona contra a média da liga (0,5 = na média; 1,0 = o dobro).",
        ],
        "generated_at": datetime.utcnow().isoformat(),
    }
