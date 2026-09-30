from datetime import datetime, timedelta, date
from typing import Dict, Any, List, Optional
import random
import hashlib
import sys
import argparse

from sqlalchemy.orm import Session

from app.db import SessionLocal, Base, engine
from app.db.models import (
    Competition, Season, Stadium, Team, Player, Match, Lineup,
    TeamStatistics, PlayerStatistics, PlayerZoneStatistics,
    TeamMatchStatistics, PlayerMatchStatistics, DefensiveWeakness,
    DataSource, DataSourceRecord, User, UserRole, PitchZone, ZONE_ORDER,
    Event, EventType,
)
from app.core.auth import hash_password
from app.services.analytics import compute_team_statistics, compute_player_statistics
from app.services.weakness import compute_team_defensive_weaknesses
from app.services.matchups import _player_offensive_attributes, _player_defensive_attributes
from app.core.logging import get_logger

logger = get_logger("seed_demo")


random.seed(42)

LEAGUES = [
    {"code": "SVPL", "name": "ScoutVision Premier League", "country": "DemoLand", "type": "league"},
    {"code": "SVCH", "name": "ScoutVision Championship", "country": "DemoLand", "type": "league"},
]

TEAMS_DATA = {
    "SVPL": [
        {"name": "Capital United", "short": "CAP", "code": "CAP", "city": "Capital City", "founded": 1901, "pos_style": "attacking", "tier": 1},
        {"name": "Harbour FC", "short": "HAR", "code": "HAR", "city": "Harbourton", "founded": 1920, "pos_style": "balanced", "tier": 1},
        {"name": "Northern Storm", "short": "NOR", "code": "NOR", "city": "Northfield", "founded": 1955, "pos_style": "defensive", "tier": 1},
        {"name": "Western Rangers", "short": "WES", "code": "WES", "city": "Westbrook", "founded": 1930, "pos_style": "balanced", "tier": 1},
        {"name": "Eastern Lions", "short": "EAS", "code": "EAS", "city": "Eastgate", "founded": 1947, "pos_style": "attacking", "tier": 1},
        {"name": "Riverside Athletic", "short": "RIV", "code": "RIV", "city": "Riverbend", "founded": 1962, "pos_style": "balanced", "tier": 2},
        {"name": "South Coast Wanderers", "short": "SCO", "code": "SCO", "city": "Southport", "founded": 1978, "pos_style": "defensive", "tier": 2},
        {"name": "Central City FC", "short": "CEN", "code": "CEN", "city": "Centraville", "founded": 1995, "pos_style": "balanced", "tier": 2},
        {"name": "Athletic Union", "short": "ATH", "code": "ATH", "city": "Unionville", "founded": 1910, "pos_style": "attacking", "tier": 2},
        {"name": "Forest Rovers", "short": "FOR", "code": "FOR", "city": "Greenwood", "founded": 1933, "pos_style": "defensive", "tier": 2},
    ],
    "SVCH": [
        {"name": "Iron Town FC", "short": "IRO", "code": "IRO", "city": "Ironville", "founded": 1950, "pos_style": "balanced", "tier": 3},
        {"name": "White Star", "short": "WST", "code": "WST", "city": "Stellaville", "founded": 1922, "pos_style": "attacking", "tier": 3},
        {"name": "Blue Eagles", "short": "BLE", "code": "BLE", "city": "Blueville", "founded": 1967, "pos_style": "defensive", "tier": 3},
        {"name": "Red Tigers", "short": "RDT", "code": "RDT", "city": "Redrock", "founded": 1973, "pos_style": "balanced", "tier": 3},
        {"name": "Green Warriors", "short": "GRN", "code": "GRN", "city": "Greendale", "founded": 1988, "pos_style": "attacking", "tier": 3},
        {"name": "Golden Arrows", "short": "GLD", "code": "GLD", "city": "Goldfield", "founded": 1999, "pos_style": "defensive", "tier": 4},
        {"name": "Silver Sharks", "short": "SLV", "code": "SLV", "city": "Silverport", "founded": 1981, "pos_style": "balanced", "tier": 4},
        {"name": "Orange Dynamo", "short": "ORG", "code": "ORG", "city": "Orange City", "founded": 2001, "pos_style": "attacking", "tier": 4},
        {"name": "Purple Knights", "short": "PPK", "code": "PPK", "city": "Purlington", "founded": 1956, "pos_style": "defensive", "tier": 4},
        {"name": "Black Panthers", "short": "BLC", "code": "BLC", "city": "Blackhaven", "founded": 1942, "pos_style": "balanced", "tier": 4},
    ],
}

STADIUMS_BY_TEAM = {
    "Capital United": ("Capital Arena", 52000),
    "Harbour FC": ("Harbour Stadium", 42000),
    "Northern Storm": ("Storm Castle", 38000),
    "Western Rangers": ("Ranger Park", 36000),
    "Eastern Lions": ("Lions Den", 40000),
    "Riverside Athletic": ("Riverbank Stadium", 25000),
    "South Coast Wanderers": ("Coastal Ground", 22000),
    "Central City FC": ("Central Park", 28000),
    "Athletic Union": ("Union Field", 21000),
    "Forest Rovers": ("Woodlands", 20000),
    "Iron Town FC": ("Forge Stadium", 18000),
    "White Star": ("Stellar Ground", 17000),
    "Blue Eagles": ("Sky Nest", 15000),
    "Red Tigers": ("Tiger Lair", 16000),
    "Green Warriors": ("Fort Green", 14000),
    "Golden Arrows": ("Arrow Park", 13000),
    "Silver Sharks": ("Shark Tank", 12000),
    "Orange Dynamo": ("Volcano Field", 11000),
    "Purple Knights": ("Knight's Arena", 11500),
    "Black Panthers": ("Panther Cage", 10500),
}

FIRST_NAMES = [
    "James", "David", "John", "Robert", "Michael", "William", "Daniel", "Matthew",
    "Anthony", "Mark", "Paul", "Steven", "Andrew", "Joshua", "Kenneth", "Kevin",
    "Brian", "George", "Thomas", "Christopher", "Ryan", "Eric", "Jason", "Jacob",
    "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Alex", "Marco",
    "Luca", "Giovanni", "Francesco", "Carlos", "Javier", "Diego", "Manuel", "Pedro",
    "Hugo", "Felix", "Oscar", "Leo", "Noah", "Ethan", "Mason", "Lucas", "Adam",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson", "Thomas",
    "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
    "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young",
    "Rossi", "Ricci", "Conti", "Ferrari", "Gonzalez", "Silva", "Costa", "Pereira",
    "Schmidt", "Mueller", "Weber", "Novak", "Kowalski", "Andersen", "Hansen",
    "Nakamura", "Tanaka", "Kim", "Park",
]

POSITIONS = ["GK", "CB", "CB", "LB", "RB", "CDM", "CM", "CM", "CAM", "RW", "LW", "ST"]
POSITION_POOL_DEFAULT = POSITIONS * 2


def _hash_name_to_rand(name: str, salt: str = "sv") -> int:
    return int(hashlib.sha256((name + salt).encode()).hexdigest(), 16)


def create_user_admin(db: Session) -> User:
    existing = db.query(User).filter(User.email == "admin@scoutvision.local").first()
    if existing:
        return existing
    u = User(
        email="admin@scoutvision.local",
        full_name="ScoutVision Admin",
        hashed_password=hash_password("admin123"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def create_user_basic(db: Session) -> User:
    existing = db.query(User).filter(User.email == "user@scoutvision.local").first()
    if existing:
        return existing
    u = User(
        email="user@scoutvision.local",
        full_name="Demo User",
        hashed_password=hash_password("user123"),
        role=UserRole.USER,
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def create_data_sources(db: Session):
    for ds in DataSource:
        r = db.query(DataSourceRecord).filter(DataSourceRecord.name == ds).first()
        if not r:
            db.add(DataSourceRecord(name=ds, description=f"{ds.value} data"))
    db.commit()


def create_competitions_and_seasons(db: Session) -> Dict[str, Season]:
    out: Dict[str, Season] = {}
    for league in LEAGUES:
        c = db.query(Competition).filter(Competition.code == league["code"]).first()
        if not c:
            c = Competition(
                name=league["name"], code=league["code"],
                country=league["country"], type=league["type"],
                data_source=DataSource.DEMO,
            )
            db.add(c); db.flush()
        # Create 3 seasons: 2022-2023 (past), 2023-2024 (past), 2024-2025 (current)
        for s_name, start, end, current in [
            ("2022/2023", date(2022, 8, 1), date(2023, 5, 31), False),
            ("2023/2024", date(2023, 8, 1), date(2024, 5, 31), False),
            ("2024/2025", date(2024, 8, 1), date(2025, 5, 31), True),
        ]:
            s = db.query(Season).filter(Season.competition_id == c.id, Season.name == s_name).first()
            if not s:
                s = Season(competition_id=c.id, name=s_name, start_date=start, end_date=end,
                           current=current, data_source=DataSource.DEMO)
                db.add(s); db.flush()
            if s_name == "2024/2025":
                out[league["code"]] = s
    db.commit()
    return out


def _create_stadiums_and_teams(db: Session):
    stadiums: Dict[str, Stadium] = {}
    teams_by_code: Dict[str, Team] = {}
    for league in LEAGUES:
        for td in TEAMS_DATA[league["code"]]:
            sname, scap = STADIUMS_BY_TEAM.get(td["name"], (td["city"] + " Stadium", 15000))
            st = db.query(Stadium).filter(Stadium.name == sname).first()
            if not st:
                st = Stadium(name=sname, city=td["city"], country="DemoLand", capacity=scap,
                             data_source=DataSource.DEMO)
                db.add(st); db.flush()
            stadiums[td["name"]] = st
            t = db.query(Team).filter(Team.name == td["name"]).first()
            if not t:
                t = Team(
                    name=td["name"], short_name=td["short"], code=td["code"],
                    country="DemoLand", founded=td["founded"], stadium_id=st.id,
                    data_source=DataSource.DEMO,
                )
                db.add(t); db.flush()
            teams_by_code[td["code"]] = t
    db.commit()
    return stadiums, teams_by_code


def _create_players_for_team(db: Session, team: Team, style: str, tier: int) -> List[Player]:
    # generate ~20 players if not present
    existing = db.query(Player).join(PlayerMatchStatistics, PlayerMatchStatistics.player_id == Player.id)\
        .filter(PlayerMatchStatistics.team_id == team.id).limit(1).count()
    if existing > 0:
        return list(db.query(Player).join(PlayerMatchStatistics, PlayerMatchStatistics.player_id == Player.id)
                    .filter(PlayerMatchStatistics.team_id == team.id).all())
    players: List[Player] = []
    base_tier_bonus = {1: 8, 2: 5, 3: 3, 4: 1}.get(tier, 0)
    style_pos_bias = {
        "attacking": {"ST": 12, "RW": 10, "LW": 10, "CAM": 8},
        "defensive": {"CB": 12, "CDM": 10, "GK": 10, "LB": 8, "RB": 8},
        "balanced": {},
    }.get(style, {})
    used = set()
    for i in range(20):
        seed_val = f"{team.id}_{i}"
        rng = random.Random(_hash_name_to_rand(seed_val))
        while True:
            fn = rng.choice(FIRST_NAMES)
            ln = rng.choice(LAST_NAMES)
            key = (fn, ln)
            if key not in used:
                used.add(key); break
        yob = 1992 + rng.randint(0, 14)
        mob = rng.randint(1, 12)
        dob = date(yob, mob, rng.randint(1, 28))
        # position: weighted
        pos_counts = POSITION_POOL_DEFAULT.copy()
        pos = pos_counts[i % len(pos_counts)]
        # style bias: ensure enough attackers or defenders
        if i < 11 and pos in style_pos_bias and rng.random() < 0.6:
            top_pick = max(style_pos_bias, key=lambda k: style_pos_bias[k])
            pos = top_pick
        height = 178 + rng.randint(-10, 16)
        weight = 72 + rng.randint(-8, 16)
        pref = rng.choice(["Right", "Left", "Both"])
        p = Player(
            first_name=fn, last_name=ln,
            display_name=f"{fn[0]}. {ln}",
            date_of_birth=dob, country="DemoLand", nationality="DemoLand",
            height_cm=height, weight_kg=weight, preferred_foot=pref, position=pos,
            data_source=DataSource.DEMO,
        )
        db.add(p); db.flush()
        players.append(p)
    db.commit()
    return players


def _make_fixture(db: Session, teams: List[Team], season: Season, stadiums: Dict[str, Stadium]) -> List[Match]:
    # Round-robin home-away = 2 * (n choose 2) matches
    matches: List[Match] = []
    n = len(teams)
    base_dt = season.start_date or datetime(2024, 8, 1)
    if isinstance(base_dt, date):
        base_dt = datetime(base_dt.year, base_dt.month, base_dt.day)
    now = datetime.utcnow()

    # Build matches: half past (played), half future
    total = n * (n - 1)
    midpoint_future = max(1, total // 2)
    idx = 0
    round_pairings: List = []
    team_list = list(teams)
    # Round robin generation
    for home in team_list:
        for away in team_list:
            if home.id == away.id:
                continue
            round_pairings.append((home, away))
    # seed shuffle with deterministic rng for season
    rng = random.Random(_hash_name_to_rand(f"fixtures_{season.id}"))
    rng.shuffle(round_pairings)
    for home, away in round_pairings:
        days = int(idx * 3.2)
        kickoff = base_dt + timedelta(days=days, hours=19, minutes=rng.choice([0, 30]))
        is_future = kickoff >= now
        status = "scheduled" if is_future else "finished"
        home_score = away_score = home_ht = away_ht = 0
        if not is_future:
            r = random.Random(_hash_name_to_rand(f"{home.id}_{away.id}_{season.id}"))
            home_bonus = 1 if (is_future or r.random() < 0.4) else 0
            home_score = r.randint(0, 4 - home_bonus)
            away_score = r.randint(0, 3)
            home_ht = r.randint(0, home_score)
            away_ht = r.randint(0, away_score)
        st = stadiums.get(home.name)
        m = Match(
            season_id=season.id, home_team_id=home.id, away_team_id=away.id,
            stadium_id=(st.id if st else None),
            kickoff_time=kickoff,
            round_name=f"Matchday {idx // n + 1}",
            matchday=idx // n + 1,
            status=status,
            home_score=home_score, away_score=away_score,
            home_ht_score=home_ht, away_ht_score=away_ht,
            referee=rng.choice(["A. Referee", "B. Official", "C. Umpire", "D. Arbiter"]),
            attendance=((st.capacity - rng.randint(0, 5000)) if st else 10000) if not is_future else None,
            data_source=DataSource.DEMO,
        )
        db.add(m); db.flush()
        matches.append(m)
        idx += 1
    db.commit()
    return matches


def _create_lineups_and_match_stats(db: Session, matches: List[Match], teams_players: Dict[int, List[Player]]):
    from app.db.models import PlayerMatchStatistics as PMS, TeamMatchStatistics as TMS
    for m in matches:
        if m.status == "scheduled":
            continue  # create lineups only for played? also lineups for future for demo (probable XI)
        for side, team_id in (("home", m.home_team_id), ("away", m.away_team_id)):
            players = teams_players.get(team_id, [])
            if not players:
                continue
            # choose 11 starters + subs
            rng = random.Random(_hash_name_to_rand(f"lineup_{m.id}_{team_id}"))
            by_pos = {}
            for p in players:
                by_pos.setdefault(p.position, []).append(p)
            chosen_order = []
            for pos in POSITIONS:  # GK, CB, CB, LB, RB, CDM, CM, CM, CAM, RW, LW, ST
                pool = by_pos.get(pos, [])
                if pool:
                    p = rng.choice(pool)
                    pool.remove(p)
                    chosen_order.append((pos, p))
                else:
                    # fallback
                    all_avail = [p for p in players if p not in [c[1] for c in chosen_order]]
                    if all_avail:
                        p = rng.choice(all_avail)
                        chosen_order.append((pos, p))
            chosen_order = chosen_order[:11]
            used_ids = set(p.id for _, p in chosen_order)
            subs = [p for p in players if p.id not in used_ids][:7]
            for idx, (pos, p) in enumerate(chosen_order):
                mins = 90
                if rng.random() < 0.3:
                    mins = rng.randint(60, 88)
                lu = Lineup(
                    match_id=m.id, team_id=team_id, player_id=p.id, is_starter=True,
                    shirt_number=rng.randint(1, 30), position=pos,
                    formation_position=pos, minutes_played=mins,
                )
                db.add(lu); db.flush()
                # synthetic stats
                stats = _synthetic_player_match_stats(p, team_id, m, mins, pos, idx)
                db.add(PMS(**stats))
            for p in subs:
                mins = rng.randint(0, 40) if m.status != "scheduled" else 0
                lu = Lineup(
                    match_id=m.id, team_id=team_id, player_id=p.id, is_starter=False,
                    shirt_number=rng.randint(12, 30), position=p.position,
                    formation_position="SUB", minutes_played=mins,
                )
                db.add(lu); db.flush()
                if mins > 0:
                    stats = _synthetic_player_match_stats(p, team_id, m, mins, p.position, 20)
                    stats["is_starter"] = False
                    db.add(PMS(**stats))
            # team match stats
            tms = _synthetic_team_match_stats(m, team_id, side)
            db.add(TMS(**tms))
    db.commit()


def _synthetic_player_match_stats(p, team_id, m, minutes, pos, seed_idx) -> Dict[str, Any]:
    rng = random.Random(_hash_name_to_rand(f"pms_{m.id}_{p.id}"))
    # baseline by position
    base = {
        "player_id": p.id, "match_id": m.id, "team_id": team_id,
        "minutes_played": minutes, "is_starter": True, "position": pos,
        "goals": 0, "assists": 0, "shots": 0, "shots_on_target": 0,
        "xg": 0.0, "passes": 0, "passes_completed": 0, "key_passes": 0,
        "xa": 0.0, "touches_in_box": 0, "tackles": 0, "interceptions": 0,
        "duels": 0, "duels_won": 0, "fouls_suffered": 0, "fouls_committed": 0,
        "rating": 6.2,
    }
    if minutes <= 0:
        return base
    mp = minutes / 90.0
    # attacker stats
    if pos in {"ST", "LW", "RW", "CF", "FW"}:
        base["shots"] = max(0, rng.randint(0, 4) if rng.random() < 0.8 else 0)
        base["shots_on_target"] = min(base["shots"], rng.randint(0, 2))
        base["goals"] = min(base["shots_on_target"], rng.choices([0, 1, 2], weights=[0.75, 0.22, 0.03])[0])
        base["xg"] = round(base["goals"] * 0.75 + base["shots_on_target"] * 0.2 + rng.random() * 0.3, 3)
        base["touches_in_box"] = max(0, int(rng.randint(1, 12) * mp))
        base["assists"] = rng.choices([0, 1, 2], weights=[0.85, 0.13, 0.02])[0]
        base["key_passes"] = base["assists"] + rng.randint(0, 3)
        base["xa"] = round(base["assists"] * 0.7 + rng.random() * 0.25, 3)
        base["fouls_suffered"] = rng.randint(0, 4)
        base["rating"] = round(6.0 + base["goals"] * 1.0 + base["assists"] * 0.7 + base["shots_on_target"] * 0.15 + rng.random() * 0.9, 2)
    elif pos in {"CAM", "CM", "CDM"}:
        base["passes"] = max(0, int(rng.randint(20, 80) * mp))
        base["passes_completed"] = max(0, int(base["passes"] * (0.7 + rng.random() * 0.25)))
        base["key_passes"] = rng.randint(0, 4)
        base["xa"] = round(rng.random() * 0.4, 3)
        base["shots"] = rng.randint(0, 2)
        base["shots_on_target"] = min(base["shots"], rng.randint(0, 1))
        base["goals"] = rng.choices([0, 1], weights=[0.92, 0.08])[0]
        base["xg"] = round(base["goals"] * 0.7 + rng.random() * 0.2, 3)
        base["assists"] = rng.choices([0, 1], weights=[0.88, 0.12])[0]
        base["tackles"] = rng.randint(0, 5) if pos in {"CDM", "CM"} else rng.randint(0, 2)
        base["interceptions"] = rng.randint(0, 3) if pos in {"CDM", "CM"} else rng.randint(0, 1)
        base["duels"] = rng.randint(2, 10)
        base["duels_won"] = min(base["duels"], rng.randint(0, base["duels"]))
        base["fouls_suffered"] = rng.randint(0, 3)
        base["fouls_committed"] = rng.randint(0, 3)
        base["rating"] = round(6.0 + base["key_passes"] * 0.2 + base["passes_completed"] / max(1, base["passes"]) * 0.8
                               + base["interceptions"] * 0.2 + rng.random() * 0.9, 2)
    elif pos in {"CB", "LB", "RB", "DF"}:
        base["tackles"] = rng.randint(1, 6)
        base["interceptions"] = rng.randint(0, 5)
        base["duels"] = rng.randint(3, 12)
        base["duels_won"] = min(base["duels"], rng.randint(1, base["duels"]))
        base["fouls_committed"] = rng.randint(0, 3)
        base["passes"] = max(0, int(rng.randint(15, 50) * mp))
        base["passes_completed"] = max(0, int(base["passes"] * (0.6 + rng.random() * 0.35)))
        base["rating"] = round(6.0 + (base["duels_won"] / max(1, base["duels"])) * 1.2
                               + base["interceptions"] * 0.15 + rng.random() * 0.9, 2)
    elif pos == "GK":
        base["passes"] = max(0, int(rng.randint(10, 30) * mp))
        base["passes_completed"] = max(0, int(base["passes"] * (0.5 + rng.random() * 0.4)))
        base["duels"] = rng.randint(0, 4)
        base["duels_won"] = rng.randint(0, base["duels"])
        base["rating"] = round(6.0 + rng.random() * 1.4, 2)
    return base


def _synthetic_team_match_stats(m, team_id, side) -> Dict[str, Any]:
    rng = random.Random(_hash_name_to_rand(f"tms_{m.id}_{team_id}"))
    is_home = side == "home"
    gf = m.home_score if is_home else m.away_score
    ga = m.away_score if is_home else m.home_score
    shots = 10 + rng.randint(0, 12) + gf * 2
    sot = min(shots, gf + rng.randint(2, 8))
    xg = round(gf * 0.9 + sot * 0.12 + rng.random() * 0.6, 3)
    xga = round(ga * 0.9 + rng.randint(2, 8) * 0.1 + rng.random() * 0.6, 3)
    passes = 300 + rng.randint(0, 400)
    return {
        "team_id": team_id, "match_id": m.id, "is_home": is_home,
        "goals": gf, "goals_conceded": ga,
        "shots": shots, "shots_on_target": sot,
        "xg": xg, "xga": xga,
        "possession_pct": round(40 + rng.random() * 20, 1),
        "passes": passes,
        "passes_completed": int(passes * (0.65 + rng.random() * 0.28)),
        "corners": rng.randint(2, 12),
        "fouls": rng.randint(6, 18),
        "tackles": rng.randint(10, 30),
        "interceptions": rng.randint(5, 22),
        "saves": max(0, ga + rng.randint(0, 5)),
    }


def _aggregate_team_and_player_stats(db: Session, teams_by_code: Dict[str, Team],
                                      teams_players: Dict[int, List[Player]], seasons_by_code: Dict[str, Season]):
    from app.repositories.repositories import MatchRepository
    mr = MatchRepository()
    # For each team, for current season (overall) compute statistics
    current_seasons = list(seasons_by_code.values())
    current_season_ids = [s.id for s in current_seasons]
    season_id_to_league = {s.id: [k for k, v in seasons_by_code.items() if v.id == s.id][0]
                           for s in current_seasons}
    # Collect all teams across leagues for simplicity
    all_teams = list(teams_by_code.values())
    for team in all_teams:
        # All historical matches (status finished)
        matches_finished = [m for m in db.query(Match)
                            .filter(((Match.home_team_id == team.id) | (Match.away_team_id == team.id)),
                                     Match.status == "finished").all()]
        if matches_finished:
            computed = compute_team_statistics(db, team.id, matches_finished, scope="overall")
            # save or update
            from app.db.models import TeamStatistics as TS
            ts = db.query(TS).filter(TS.team_id == team.id, TS.season_id.is_(None), TS.scope == "overall").first()
            if ts:
                for k, v in computed.items():
                    setattr(ts, k, v)
                db.flush()
            else:
                db.add(TS(**computed))
    # Player aggregates
    for tid, players in teams_players.items():
        for p in players:
            from app.db.models import PlayerMatchStatistics as PMS
            rows = db.query(PMS).filter(PMS.player_id == p.id, PMS.minutes_played > 0).all()
            if not rows:
                continue
            row_dicts = [r.__dict__ for r in rows]
            computed = compute_player_statistics(db, p.id, row_dicts, scope="overall")
            # offensive/defensive scores via helper
            from app.db.models import PlayerStatistics as PS
            existing = db.query(PS).filter(PS.player_id == p.id, PS.season_id.is_(None), PS.scope == "overall").first()
            # Pace/dribble/workrate attributes
            rng = random.Random(_hash_name_to_rand(f"attrs_{p.id}"))
            if existing:
                for k, v in computed.items():
                    if hasattr(existing, k):
                        setattr(existing, k, v)
                existing.pace = round(rng.uniform(0.45, 0.95), 3) if not existing.pace else existing.pace
                existing.dribbling = round(rng.uniform(0.35, 0.90), 3) if not existing.dribbling else existing.dribbling
                existing.defensive_workrate = round(rng.uniform(0.35, 0.92), 3) if not existing.defensive_workrate else existing.defensive_workrate
                existing.attacking_workrate = round(rng.uniform(0.35, 0.92), 3) if not existing.attacking_workrate else existing.attacking_workrate
                db.flush()
            else:
                computed["pace"] = round(rng.uniform(0.45, 0.95), 3)
                computed["dribbling"] = round(rng.uniform(0.35, 0.90), 3)
                computed["defensive_workrate"] = round(rng.uniform(0.35, 0.92), 3)
                computed["attacking_workrate"] = round(rng.uniform(0.35, 0.92), 3)
                db.add(PS(**computed))
    db.commit()


def _compute_weaknesses_and_zone_stats(db: Session, teams_by_code, teams_players, seasons_by_code):
    from app.db.models import TeamStatistics as TS
    current_season_ids = [s.id for s in seasons_by_code.values()]
    for team in teams_by_code.values():
        matches_finished = [m for m in db.query(Match)
                            .filter(((Match.home_team_id == team.id) | (Match.away_team_id == team.id)),
                                     Match.status == "finished").all()]
        dw_list = compute_team_defensive_weaknesses(db, team.id, matches_finished)
        for dw in dw_list:
            from app.db.models import DefensiveWeakness as DW
            existing = db.query(DW).filter(DW.team_id == team.id,
                                            DW.season_id.is_(None), DW.zone == dw["zone"]).first()
            if existing:
                for k, v in dw.items():
                    if hasattr(existing, k):
                        setattr(existing, k, v)
                db.flush()
            else:
                db.add(DW(**dw))
    db.commit()

    # Player zone stats
    for tid, players in teams_players.items():
        for p in players:
            from app.db.models import PlayerStatistics as PS
            ps = db.query(PS).filter(PS.player_id == p.id, PS.scope == "overall").first()
            if not ps:
                continue
            off_attrs = _player_offensive_attributes(ps)
            def_attrs = _player_defensive_attributes(ps)
            total_freq = 0.0
            rows = []
            rng = random.Random(_hash_name_to_rand(f"zones_{p.id}"))
            is_attack = (p.position or "") in {"ST", "LW", "RW", "CF", "FW", "CAM"}
            is_def = (p.position or "") in {"CB", "LB", "RB", "GK", "CDM", "DF"}
            # base frequencies: attackers in final third, defenders in own half
            freq_map = {}
            for zone in ZONE_ORDER:
                base = 0.5 + rng.random() * 2.0
                if is_attack:
                    if zone.value.startswith("opp") or zone in {PitchZone.CENTRAL_BOX, PitchZone.OUTSIDE_BOX_CENTRAL,
                                                                PitchZone.OUTSIDE_BOX_LEFT, PitchZone.OUTSIDE_BOX_RIGHT}:
                        base *= 3.0
                    elif zone.value.startswith("own"):
                        base *= 0.3
                if is_def:
                    if zone.value.startswith("own"):
                        base *= 3.0
                    elif zone in {PitchZone.CENTRAL_BOX}:
                        base *= 0.5
                freq_map[zone] = base
            total = sum(freq_map.values()) or 1.0
            for zone in ZONE_ORDER:
                freq_pct = freq_map[zone] / total * 100
                freq_ratio = freq_pct / 100
                sample = int(ps.matches_played * freq_ratio * (0.5 + rng.random()))
                # Touches
                touches = int(ps.matches_played * freq_ratio * 10 * rng.uniform(0.4, 1.6))
                shots = 0
                sot = 0
                goals = 0
                xg = 0.0
                passes = 0
                key_passes = 0
                xa = 0.0
                if zone in {PitchZone.CENTRAL_BOX, PitchZone.OUTSIDE_BOX_CENTRAL,
                            PitchZone.OPP_LEFT_CHANNEL, PitchZone.OPP_RIGHT_CHANNEL}:
                    shots = int(ps.shots * freq_ratio * rng.uniform(0.6, 1.3))
                    sot = min(shots, int(shots * rng.uniform(0.25, 0.55)))
                    goals = min(sot, int(ps.goals * freq_ratio * rng.uniform(0.7, 1.2)))
                    xg = round(ps.xg_total * freq_ratio * rng.uniform(0.7, 1.3), 3)
                if not zone.value.startswith("own"):
                    passes = int(ps.passes * freq_ratio * rng.uniform(0.6, 1.3))
                    key_passes = int(ps.key_passes * freq_ratio * rng.uniform(0.5, 1.4))
                    xa = round(ps.xa_total * freq_ratio * rng.uniform(0.5, 1.3), 3)
                # offensive strength per zone
                zone_offensive = 0.0
                if zone.value.startswith("opp") or zone in {PitchZone.CENTRAL_BOX,
                                                             PitchZone.OUTSIDE_BOX_LEFT,
                                                             PitchZone.OUTSIDE_BOX_RIGHT,
                                                             PitchZone.OUTSIDE_BOX_CENTRAL}:
                    zone_offensive = (off_attrs["shooting"] * 0.35 + off_attrs["dribbling"] * 0.25 +
                                      off_attrs["passing"] * 0.2 + off_attrs["touches_box_p90"] * 0.2) * freq_ratio * 2.5
                    # boost if box
                    if zone in {PitchZone.CENTRAL_BOX}:
                        zone_offensive *= 1.8
                else:
                    zone_offensive = (def_attrs["tackling"] * 0.4 + def_attrs["interception"] * 0.35 +
                                      def_attrs["duel_strength"] * 0.25) * freq_ratio * 1.2
                zone_offensive = min(1.0, zone_offensive)
                minutes_90 = max(1.0, ps.minutes_played / 90.0)
                row = {
                    "player_id": p.id, "season_id": None, "zone": zone,
                    "sample_size": max(0, sample),
                    "touches": touches, "shots": shots, "shots_on_target": sot, "goals": goals,
                    "xg": xg, "passes": passes, "key_passes": key_passes, "xa": xa,
                    "touches_per_90": round(touches / minutes_90, 3),
                    "shots_per_90": round(shots / minutes_90, 4),
                    "xg_per_90": round(xg / minutes_90, 4),
                    "zone_frequency_pct": round(freq_pct, 3),
                    "offensive_strength": round(zone_offensive, 4),
                }
                rows.append(row)
            from app.db.models import PlayerZoneStatistics as PZS
            for row in rows:
                existing = db.query(PZS).filter(PZS.player_id == p.id,
                                                 PZS.season_id.is_(None), PZS.zone == row["zone"]).first()
                if existing:
                    for k, v in row.items():
                        if hasattr(existing, k):
                            setattr(existing, k, v)
                    db.flush()
                else:
                    db.add(PZS(**row))
    db.commit()


def _seed_model_versions(db: Session):
    from app.db.models import ModelVersion
    from app.ml.models import model_store
    for t in model_store.available_targets():
        meta = model_store.metadata(t)
        ev = meta["evaluation"]
        existing = db.query(ModelVersion).filter(ModelVersion.name == meta["name"],
                                                  ModelVersion.version == meta["version"]).first()
        if not existing:
            db.add(ModelVersion(
                name=meta["name"], version=meta["version"], target=meta["target"],
                algorithm=meta["algorithm"],
                train_season_range="2022/2023-2023/2024",
                val_season_range="2023/2024 matchday 15-25",
                test_season_range="2024/2025 (synthetic)",
                accuracy=ev["accuracy"], precision=ev["precision"], recall=ev["recall"], f1=ev["f1"],
                roc_auc=ev["roc_auc"], log_loss=ev["log_loss"], brier_score=ev["brier_score"],
                feature_names=meta["feature_names"], is_active=True,
            ))
    db.commit()


def run_seed(db: Optional[Session] = None, force: bool = False) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    own_db = False
    if db is None:
        db = SessionLocal()
        own_db = True
    try:
        # quick check for existing demo data
        t = db.query(Team).first()
        if t and not force:
            logger.info("Demo data already exists; skipping seed (use --force to rebuild)")
            counts["skipped"] = 1
            return counts

        admin = create_user_admin(db); counts["users"] = 1
        _ = create_user_basic(db); counts["users"] += 1
        create_data_sources(db)
        seasons_by_code = create_competitions_and_seasons(db)
        counts["competitions"] = 2; counts["seasons"] = 6
        stadiums, teams_by_code = _create_stadiums_and_teams(db)
        counts["stadiums"] = len(stadiums); counts["teams"] = len(teams_by_code)
        teams_players: Dict[int, List[Player]] = {}
        for league in LEAGUES:
            for td in TEAMS_DATA[league["code"]]:
                team = teams_by_code[td["code"]]
                players = _create_players_for_team(db, team, td["pos_style"], td["tier"])
                teams_players[team.id] = players
        counts["players"] = sum(len(v) for v in teams_players.values())
        # create matches per season
        all_matches: List[Match] = []
        for league in LEAGUES:
            season = seasons_by_code[league["code"]]
            league_teams = [teams_by_code[td["code"]] for td in TEAMS_DATA[league["code"]]]
            matches = _make_fixture(db, league_teams, season, stadiums)
            all_matches.extend(matches)
        counts["matches"] = len(all_matches)
        _create_lineups_and_match_stats(db, all_matches, teams_players)
        _aggregate_team_and_player_stats(db, teams_by_code, teams_players, seasons_by_code)
        _compute_weaknesses_and_zone_stats(db, teams_by_code, teams_players, seasons_by_code)
        _seed_model_versions(db)
        counts["statistics"] = counts["teams"] + counts["players"]
        counts["zone_stats"] = counts["players"] * len(ZONE_ORDER)
        counts["weaknesses"] = counts["teams"] * len(ZONE_ORDER)
        db.commit()
        logger.info(f"Seed complete: {counts}")
        return counts
    finally:
        if own_db:
            db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--if-empty", action="store_true", help="Only seed if no teams exist")
    args = parser.parse_args()
    run_seed(force=args.force)


if __name__ == "__main__":
    main()
