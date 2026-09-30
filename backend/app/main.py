from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

from app.config import get_settings
from app.core.logging import get_logger
from app.api.auth import router as auth_router
from app.api.competitions import router as comp_router
from app.api.teams import router as teams_router
from app.api.players import router as players_router
from app.api.matches import router as matches_router
from app.api.models import router as models_router

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
    except Exception as e:
        return {"status": "degraded", "db": f"error: {e}"}


@app.get("/api/health", tags=["meta"])
def api_health():
    return health()


api_prefix = "/api"
app.include_router(auth_router, prefix=api_prefix)
app.include_router(comp_router, prefix=api_prefix)
app.include_router(teams_router, prefix=api_prefix)
app.include_router(players_router, prefix=api_prefix)
app.include_router(matches_router, prefix=api_prefix)
app.include_router(models_router, prefix=api_prefix)
