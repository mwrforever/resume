import logging
from app.core.config import get_settings


def configure_logging(settings=None) -> None:
    target_settings = settings or get_settings()
    logging.basicConfig(level=target_settings.logging_level_value)
    logging.getLogger().setLevel(target_settings.logging_level_value)
