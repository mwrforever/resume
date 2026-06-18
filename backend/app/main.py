import asyncio
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

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.mysql import mysql_manager
from app.db.redis import redis_manager
from app.core.exceptions import BizError
from app.api.v1.router import api_router
from app.services.cache_service import CacheService
from langgraph.checkpoint.memory import MemorySaver
from app.llm.graphs.workflows.interview_questions import build_interview_graph
from app.llm.graphs.workflows.resume_evaluation import build_evaluation_graph

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
    await asyncio.gather(
        mysql_manager.init_pool(),
        redis_manager.init_client(),
    )
    app.state.redis = redis_manager.client
    app.state.mysql = mysql_manager.engine

    app.state.cache = CacheService(app.state.redis)

    # 编译两个 Agent 工作流图（MemorySaver checkpointer，per-process 共享）
    checkpointer = MemorySaver()
    app.state.agent_workflow_graphs = {
        "interview_questions": build_interview_graph(checkpointer),
        "resume_evaluation": build_evaluation_graph(checkpointer),
    }
    logging.getLogger(__name__).info("两个 Agent 工作流图已编译，使用 MemorySaver checkpointer")

    try:
        yield
    finally:
        await asyncio.gather(
            redis_manager.close_client(),
            mysql_manager.close_pool(),
        )


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
