from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "resume_platform",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["celery_app.tasks.eval_task"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_routes={
        "celery_app.tasks.eval_task.*": {"queue": "eval"}
    }
)