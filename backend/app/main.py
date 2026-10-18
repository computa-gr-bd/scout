from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.logging import get_logger
from app.api.auth import router as auth_router
from app.api.competitions import router as comp_router
from app.api.teams import router as teams_router
from app.api.players import router as players_router
from app.api.matches import router as matches_router
from app.api.models import router as models_router
from app.db.models import CollectionState
from app.db import get_db
from sqlalchemy import select

settings = get_settings()
logger = get_logger("scoutvision.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        f"Starting ScoutVision backend env={settings.ENVIRONMENT} "
        f"model_path={settings.MODEL_PATH}"
    )
    if settings.TRAIN_ON_STARTUP:
        logger.info("TRAIN_ON_STARTUP=true — training baseline models")
    yield
    logger.info("Shutting down ScoutVision backend")


app = FastAPI(
    title="ScoutVision API",
    description="Pre-match football scouting & predictive analytics platform",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "body": exc.body},
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


@app.get("/", tags=["meta"])
def root():
    return {
        "name": "ScoutVision",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", tags=["meta"])
def health():
    from app.db import engine
    from sqlalchemy import text
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "db": "unavailable"})


@app.get("/api/health", tags=["meta"])
def api_health():
    return health()


@app.get("/api/stats/counts", tags=["meta"])
def api_stats_counts():
    from app.db import SessionLocal
    from app.db.models import (
        Competition, Team, Match, Player, Standing, Event,
        Shot, Pass, TeamStatistics, ModelVersion,
    )
    from sqlalchemy import select, func
    rows = {
        "competitions": Competition, "teams": Team, "matches": Match,
        "players": Player, "standings": Standing, "events": Event,
        "shots": Shot, "passes": Pass, "team_statistics": TeamStatistics,
        "model_versions": ModelVersion,
    }
    out: dict = {}
    with SessionLocal() as db:
        for key, model in rows.items():
            try:
                out[key] = db.scalar(select(func.count()).select_from(model)) or 0
            except Exception:
                out[key] = None
    return out


@app.get("/api/data/status", tags=["meta"])
def api_data_status(db: Session = Depends(get_db)):
    states = db.scalars(
        select(CollectionState).order_by(CollectionState.provider, CollectionState.resource)
    ).all()
    now = datetime.now(timezone.utc)
    stale_after = settings.SYNC_INTERVAL_HOURS * 2

    def as_utc(value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def checkpoint_payload(state: CollectionState) -> dict[str, object]:
        last_success_at = as_utc(state.last_success_at)
        return {
            "provider": state.provider,
            "resource": state.resource,
            "status": state.status,
            "last_success_at": last_success_at,
            "updated_at": as_utc(state.updated_at),
            "summary": state.summary,
            "is_stale": (
                state.provider == "football_data"
                and (
                    last_success_at is None
                    or (now - last_success_at).total_seconds() > stale_after * 3600
                )
            ),
        }

    return {
        "sync_interval_hours": settings.SYNC_INTERVAL_HOURS,
        "competitions": [checkpoint_payload(state) for state in states],
    }


api_prefix = "/api"
app.include_router(auth_router, prefix=api_prefix)
app.include_router(comp_router, prefix=api_prefix)
app.include_router(teams_router, prefix=api_prefix)
app.include_router(players_router, prefix=api_prefix)
app.include_router(matches_router, prefix=api_prefix)
app.include_router(models_router, prefix=api_prefix)
