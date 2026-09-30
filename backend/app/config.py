from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/scoutvision"
    SECRET_KEY: str = "dev-secret-change-me-please-use-a-long-random-string"
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    API_FOOTBALL_KEY: str = ""
    STATSBOMB_LOCAL_DATA_PATH: str = ""

    MODEL_PATH: str = "./data/models"
    TRAIN_ON_STARTUP: bool = False

    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    MIN_SAMPLE_THRESHOLD: int = 5
    DEFAULT_PITCH_ZONES: int = 18

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
