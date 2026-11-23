"""Resolve the official table for the same competition and season."""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Competition, DataSource, Season, Standing, Team


def official_standings_for_season(db: Session, season: Season) -> list[tuple[Standing, Team]]:
    competition = db.get(Competition, season.competition_id)
    if not competition or not competition.code or not competition.country or not season.start_date:
        return []
    year = season.start_date.year
    seasons = db.scalars(
        select(Season).join(Competition, Competition.id == Season.competition_id).where(
            Competition.code == competition.code,
            func.lower(func.trim(Competition.country)) == competition.country.strip().lower(),
            Competition.data_source == DataSource.FOOTBALL_DATA,
            Season.start_date >= date(year, 1, 1),
            Season.start_date < date(year + 1, 1, 1),
            Season.id.in_(select(Standing.season_id)),
        )
    ).all()
    if len(seasons) != 1:
        return []
    rows = db.execute(
        select(Standing, Team).join(Team, Team.id == Standing.team_id)
        .where(Standing.season_id == seasons[0].id, Standing.group_name == "")
        .order_by(Standing.position)
    ).all()
    return [(standing, team) for standing, team in rows]
