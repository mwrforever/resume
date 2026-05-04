import logging
from contextlib import asynccontextmanager

import celery
import fastapi
import pydantic
import redis
import sqlalchemy
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.core.config import configure_logging, get_settings
from app.db.mysql import mysql_manager
from app.db.redis import redis_manager
from app.core.exceptions import BizError
from app.api.v1.router import api_router

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    await mysql_manager.init_pool()
    await redis_manager.init_client()

    try:
        yield
    finally:
        await redis_manager.close_client()
        await mysql_manager.close_pool()


app = FastAPI(
    title=settings.APP_NAME,
    lifespan=lifespan,
)


@app.exception_handler(BizError)
async def biz_error_handler(request, exc: BizError):
    return JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": None}
    )

app.include_router(api_router, prefix="/api/v1")
app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )