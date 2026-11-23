from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import get_settings

settings = get_settings()

connect_args = {}
database_url = make_url(settings.DATABASE_URL)
if database_url.drivername == "sqlite":
    connect_args["check_same_thread"] = False
elif database_url.drivername == "postgresql+psycopg" and database_url.host and "pooler" in database_url.host:
    # Neon pooler connections do not preserve psycopg's server-side prepared statements.
    connect_args["prepare_threshold"] = None

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True, connect_args=connect_args)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
