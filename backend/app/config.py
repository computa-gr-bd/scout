from functools import lru_cache
from pathlib import Path
from typing import List
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(__file__).resolve().parents[2] / ".env",
                  Path(__file__).resolve().parents[1] / ".env"),
        case_sensitive=True, extra="ignore",
    )

    DATABASE_URL: str
    SECRET_KEY: str = "dev-secret-change-me-please-use-a-long-random-string"
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    API_FOOTBALL_KEY: str = ""
    FOOTBALL_DATA_TOKEN: str = ""
    SYNC_COMPETITIONS: str = "BSA,PL,BL1,PD,SA,FL1,CL"
    STATSBOMB_LOCAL_DATA_PATH: str = ""

    MODEL_PATH: str = "./data/models"
    TRAIN_ON_STARTUP: bool = False

    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    MIN_SAMPLE_THRESHOLD: int = 5
    DEFAULT_PITCH_ZONES: int = 18

    @field_validator("DATABASE_URL")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        from sqlalchemy.engine import make_url
        url = make_url(value)
        if url.drivername in ("postgres", "postgresql"):
            url = url.set(drivername="postgresql+psycopg")
        if url.host and url.host.endswith(".neon.tech"):
            url = url.update_query_dict({"sslmode": "require", "connect_timeout": "15"})
        return url.render_as_string(hide_password=False)

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
