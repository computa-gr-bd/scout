"""Run the football-data collection repeatedly for long-lived deployments."""
from __future__ import annotations

import time

from app.config import get_settings
from app.core.logging import get_logger
from app.services.data_sync import sync_football_data_for_competitions

logger = get_logger("scoutvision.data_sync_worker")


def main():
    settings = get_settings()
    interval_seconds = settings.SYNC_INTERVAL_HOURS * 60 * 60
    retry_seconds = min(15 * 60, interval_seconds)

    while True:
        try:
            summary = sync_football_data_for_competitions()
        except Exception:
            logger.exception("Coleta falhou; nova tentativa em %s segundos.", retry_seconds)
            time.sleep(retry_seconds)
        else:
            logger.info("Coleta concluída: %s", summary)
            time.sleep(interval_seconds)


if __name__ == "__main__":
    main()
