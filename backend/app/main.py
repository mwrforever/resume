import logging

import celery
import fastapi
import pydantic
import redis
import sqlalchemy

from app.infrastructure.config.settings import configure_logging, get_settings
from app.container import create_app

settings = get_settings()
configure_logging(settings)
logging.getLogger(__name__).info(
    "Backend dependencies loaded: fastapi=%s pydantic=%s sqlalchemy=%s redis=%s celery=%s",
    fastapi.__version__,
    pydantic.__version__,
    sqlalchemy.__version__,
    redis.__version__,
    celery.__version__,
)
app = create_app(settings)
