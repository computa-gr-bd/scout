"""Aggregate statistics derived from persisted StatsBomb event data."""
from __future__ import annotations

from typing import Dict, List, Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Event, EventType, Goal, Lineup, Match, Pass, Player, PlayerMatchStatistics,
    PlayerStatistics, Shot, Team, TeamMatchStatistics, TeamStatistics,
)
from app.services.utils import per90, safe_div


def _team_ids_for_match(match: Match) -> List[int]:
    return [t for t in (match.home_team_id, match.away_team_id) if t]


def compute_match_aggregates(db: Session, match: Match) -> None:
    db.execute(delete(TeamMatchStatistics).where(TeamMatchStatistics.match_id == match.id))
    db.execute(delete(PlayerMatchStatistics).where(PlayerMatchStatistics.match_id == match.id))

    events = list(db.scalars(select(Event).where(Event.match_id == match.id)).all())
    shot_rows = db.execute(
        select(Shot, Event).join(Event, Shot.event_id == Event.id)
        .where(Event.match_id == match.id)
    ).all()
    pass_rows = db.execute(
        select(Pass, Event).join(Event, Pass.event_id == Event.id)
        .where(Event.match_id == match.id)
    ).all()

    home_id = match.home_team_id
    away_id = match.away_team_id

    def team_stats(tid: int, is_home: bool) -> Dict[str, float]:
        opp = away_id if tid == home_id else home_id
        t_events = [e for e in events if e.team_id == tid]
        t_shots = [r for r in shot_rows if r[1].team_id == tid]
        t_passes = [r for r in pass_rows if r[1].team_id == tid]
        goals = sum(1 for e in t_events if e.type == EventType.GOAL)
        shots_n = len(t_shots)
        sot = sum(1 for r in t_shots if r[0].on_target)
        xg = float(sum((r[0].xg or 0.0) for r in t_shots))
        opp_shots = [r for r in shot_rows if r[1].team_id == opp]
        xga = float(sum((r[0].xg or 0.0) for r in opp_shots))
        passes_n = len(t_passes)
        passes_completed = sum(1 for r in t_passes if (r[1].outcome or "").lower() in ("complete", "completed"))
        key_passes = sum(1 for r in t_passes if r[0].is_key_pass)
        corners = sum(1 for e in t_events if e.type == EventType.CORNER)
        fouls = sum(1 for e in t_events if e.type == EventType.FOUL)
        tackles = sum(1 for e in t_events if e.type == EventType.TACKLE)
        interceptions = sum(1 for e in t_events if e.type == EventType.INTERCEPTION)
        total_passes = len(pass_rows) or 1
        possession = (passes_n / total_passes) * 100.0
        return {
            "team_id": tid, "match_id": match.id, "is_home": is_home,
            "goals": goals,
            "goals_conceded": (match.away_score if is_home else match.home_score) or 0,
            "shots": shots_n, "shots_on_target": sot, "xg": xg, "xga": xga,
            "possession_pct": possession, "passes": passes_n,
            "passes_completed": passes_completed, "corners": corners, "fouls": fouls,
            "tackles": tackles, "interceptions": interceptions, "saves": 0,
        }

    for tid, is_home in ((home_id, True), (away_id, False)):
        if not tid:
            continue
        db.add(TeamMatchStatistics(**team_stats(tid, is_home)))

    lineups = list(db.scalars(select(Lineup).where(Lineup.match_id == match.id)).all())
    shots_by_player: Dict[int, List] = {}
    for r in shot_rows:
        pid = r[1].player_id
        if pid is not None:
            shots_by_player.setdefault(pid, []).append(r)
    passes_by_player: Dict[int, List] = {}
    for r in pass_rows:
        pid = r[1].player_id
        if pid is not None:
            passes_by_player.setdefault(pid, []).append(r)

    goals_by_player: Dict[int, int] = {}
    for g in db.scalars(select(Goal)).all():
        ev = db.get(Event, g.event_id)
        if ev is not None and ev.match_id == match.id and g.scorer_player_id:
            goals_by_player[g.scorer_player_id] = goals_by_player.get(g.scorer_player_id, 0) + 1

    assists_by_player: Dict[int, int] = {}
    for r in pass_rows:
        if r[0].is_assist and r[1].player_id is not None:
            assists_by_player[r[1].player_id] = assists_by_player.get(r[1].player_id, 0) + 1

    for lu in lineups:
        pid = lu.player_id
        p_shots = shots_by_player.get(pid, [])
        p_passes = passes_by_player.get(pid, [])
        goals = goals_by_player.get(pid, 0)
        assists = assists_by_player.get(pid, 0)
        sot = sum(1 for r in p_shots if r[0].on_target)
        xg = float(sum((r[0].xg or 0.0) for r in p_shots))
        passes_n = len(p_passes)
        passes_completed = sum(1 for r in p_passes if (r[1].outcome or "").lower() in ("complete", "completed"))
        key_passes = sum(1 for r in p_passes if r[0].is_key_pass)
        touches_in_box = len(p_shots)
        tackles = sum(1 for e in events if e.player_id == pid and e.type == EventType.TACKLE)
        interceptions = sum(1 for e in events if e.player_id == pid and e.type == EventType.INTERCEPTION)
        duels = sum(1 for e in events if e.player_id == pid and e.type == EventType.DUEL)
        fouls = sum(1 for e in events if e.player_id == pid and e.type == EventType.FOUL)
        minutes = lu.minutes_played
        db.add(PlayerMatchStatistics(
            player_id=pid, match_id=match.id, team_id=lu.team_id,
            minutes_played=minutes if minutes is not None else 0,
            is_starter=bool(lu.is_starter), position=lu.position,
            goals=goals, assists=assists, shots=len(p_shots), shots_on_target=sot,
            xg=xg, passes=passes_n, passes_completed=passes_completed,
            key_passes=key_passes, xa=0.0, touches_in_box=touches_in_box,
            tackles=tackles, interceptions=interceptions, duels=duels,
            duels_won=0, fouls_suffered=fouls, fouls_committed=fouls,
        ))
def compute_team_season_aggregates(db: Session, team_id: int, season_id: Optional[int]) -> None:
    if season_id is not None:
        matches = list(db.scalars(
            select(Match).where(
                ((Match.home_team_id == team_id) | (Match.away_team_id == team_id)),
                Match.season_id == season_id,
            )
        ).all())
    else:
        matches = list(db.scalars(
            select(Match).where(
                (Match.home_team_id == team_id) | (Match.away_team_id == team_id),
            )
        ).all())

    match_ids = {m.id for m in matches}
    tms_rows = [r for r in db.scalars(
        select(TeamMatchStatistics).where(TeamMatchStatistics.team_id == team_id)
    ).all() if r.match_id in match_ids]

    wins = draws = losses = 0
    gf = ga = 0
    shots_f = sot_f = 0
    xg_f = xga_f = 0.0
    corners_f = 0
    total_matches = len(tms_rows)
    for r in tms_rows:
        gf += r.goals or 0
        ga += r.goals_conceded or 0
        if (r.goals or 0) > (r.goals_conceded or 0):
            wins += 1
        elif (r.goals or 0) == (r.goals_conceded or 0):
            draws += 1
        else:
            losses += 1
        shots_f += r.shots or 0
        sot_f += r.shots_on_target or 0
        xg_f += r.xg or 0.0
        xga_f += r.xga or 0.0
        corners_f += r.corners or 0
    total_minutes = total_matches * 90 or 1
    shots_per_90 = (shots_f / total_minutes) * 90
    sot_per_90 = (sot_f / total_minutes) * 90
    xg_per_90 = (xg_f / total_minutes) * 90
    xga_per_90 = (xga_f / total_minutes) * 90
    gcp90 = (ga / total_minutes) * 90
    corners_per_90 = (corners_f / total_minutes) * 90
    points = wins * 3 + draws
    ppg = points / total_matches if total_matches else 0.0

    sorted_matches = sorted(matches, key=lambda m: m.kickoff_time, reverse=True)
    recent_form = []
    for m in sorted_matches[:5]:
        is_home = m.home_team_id == team_id
        team_gf = m.home_score if is_home else m.away_score
        team_ga = m.away_score if is_home else m.home_score
        res = "W" if (team_gf or 0) > (team_ga or 0) else ("D" if team_gf == team_ga else "L")
        recent_form.append({"match_id": m.id, "result": res, "gf": team_gf, "ga": team_ga})

    existing = db.scalar(select(TeamStatistics).where(
        TeamStatistics.team_id == team_id,
        TeamStatistics.scope == "overall",
        TeamStatistics.season_id == season_id if season_id is not None else TeamStatistics.season_id.is_(None),
    ))
    values = dict(
        team_id=team_id, season_id=season_id, scope="overall",
        matches_played=total_matches, wins=wins, draws=draws, losses=losses,
        goals_for=gf, goals_against=ga, shots=shots_f, shots_on_target=sot_f,
        xg_total=xg_f, xga_total=xga_f, corners_total=corners_f,
        shots_per_90=shots_per_90, shots_on_target_per_90=sot_per_90,
        xg_per_90=xg_per_90, xga_per_90=xga_per_90,
        goals_conceded_per_90=gcp90, shots_conceded_per_90=0.0,
        corners_per_90=corners_per_90, points_per_game=ppg,
        recent_form=recent_form,
    )
    if existing is None:
        db.add(TeamStatistics(**values))
    else:
        for k, v in values.items():
            setattr(existing, k, v)
def compute_player_season_aggregates(db: Session, player_id: int, season_id: Optional[int]) -> None:
    pms_rows = list(db.scalars(
        select(PlayerMatchStatistics).where(PlayerMatchStatistics.player_id == player_id)
    ).all())
    if season_id is not None:
        season_match_ids = {m.id for m in db.scalars(
            select(Match).where(Match.season_id == season_id)
        ).all()}
        pms_rows = [r for r in pms_rows if r.match_id in season_match_ids]

    if not pms_rows:
        return
    totals = {
        "matches_played": len(pms_rows),
        "minutes_played": sum(r.minutes_played or 0 for r in pms_rows),
        "starts": sum(1 for r in pms_rows if r.is_starter),
        "goals": sum(r.goals or 0 for r in pms_rows),
        "assists": sum(r.assists or 0 for r in pms_rows),
        "shots": sum(r.shots or 0 for r in pms_rows),
        "shots_on_target": sum(r.shots_on_target or 0 for r in pms_rows),
        "xg_total": float(sum(r.xg or 0.0 for r in pms_rows)),
        "xa_total": 0.0,
        "passes": sum(r.passes or 0 for r in pms_rows),
        "passes_completed": sum(r.passes_completed or 0 for r in pms_rows),
        "key_passes": sum(r.key_passes or 0 for r in pms_rows),
        "touches_in_box": sum(r.touches_in_box or 0 for r in pms_rows),
        "dribbles": 0, "dribbles_success": 0,
        "fouls_suffered": sum(r.fouls_suffered or 0 for r in pms_rows),
        "fouls_committed": sum(r.fouls_committed or 0 for r in pms_rows),
        "tackles": sum(r.tackles or 0 for r in pms_rows),
        "interceptions": sum(r.interceptions or 0 for r in pms_rows),
        "clearances": 0, "duels": sum(r.duels or 0 for r in pms_rows),
        "duels_won": sum(r.duels_won or 0 for r in pms_rows),
        "crosses": 0, "crosses_completed": 0,
        "corners_taken": 0,
    }
    minutes = totals["minutes_played"] or 1
    values = dict(
        player_id=player_id, season_id=season_id, scope="overall",
        matches_played=totals["matches_played"],
        minutes_played=totals["minutes_played"],
        starts=totals["starts"],
        goals=totals["goals"], assists=totals["assists"],
        shots=totals["shots"], shots_on_target=totals["shots_on_target"],
        xg_total=totals["xg_total"], xa_total=totals["xa_total"],
        passes=totals["passes"], passes_completed=totals["passes_completed"],
        key_passes=totals["key_passes"], touches_in_box=totals["touches_in_box"],
        dribbles=totals["dribbles"], dribbles_success=totals["dribbles_success"],
        fouls_suffered=totals["fouls_suffered"], fouls_committed=totals["fouls_committed"],
        tackles=totals["tackles"], interceptions=totals["interceptions"],
        clearances=totals["clearances"], duels=totals["duels"], duels_won=totals["duels_won"],
        crosses=totals["crosses"], crosses_completed=totals["crosses_completed"],
        corners_taken=totals["corners_taken"],
        shots_per_90=per90(totals["shots"], minutes),
        shots_on_target_per_90=per90(totals["shots_on_target"], minutes),
        xg_per_90=per90(totals["xg_total"], minutes),
        xa_per_90=per90(totals["xa_total"], minutes),
        key_passes_per_90=per90(totals["key_passes"], minutes),
        touches_in_box_per_90=per90(totals["touches_in_box"], minutes),
        corners_per_90=per90(totals["corners_taken"], minutes),
        goals_per_90=per90(totals["goals"], minutes),
        assists_per_90=per90(totals["assists"], minutes),
        tackle_pct=0.0, dribble_success_pct=0.0,
        pass_accuracy_pct=safe_div(totals["passes_completed"], max(1, totals["passes"])) * 100,
        recent_form=[],
    )
    existing = db.scalar(select(PlayerStatistics).where(
        PlayerStatistics.player_id == player_id,
        PlayerStatistics.scope == "overall",
        PlayerStatistics.season_id == season_id if season_id is not None else PlayerStatistics.season_id.is_(None),
    ))
    if existing is None:
        db.add(PlayerStatistics(**values))
    else:
        for k, v in values.items():
            setattr(existing, k, v)


def populate_aggregates_for_match(db: Session, match: Match) -> None:
    try:
        compute_match_aggregates(db, match)
    except Exception:
        pass
    for tid in _team_ids_for_match(match):
        try:
            compute_team_season_aggregates(db, tid, match.season_id)
        except Exception:
            pass
    player_ids = [lu.player_id for lu in db.scalars(
        select(Lineup).where(Lineup.match_id == match.id)
    ).all()]
    for pid in set(player_ids):
        try:
            compute_player_season_aggregates(db, pid, match.season_id)
        except Exception:
            pass