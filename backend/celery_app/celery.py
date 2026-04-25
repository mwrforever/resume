from celery import Celery
from app.core.config import get_settings

settings = get_settings()


celery_app = Celery(
    "resume_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
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
    },
    # Windows 兼容设置：使用 threads 池避免 spawn 多进程的权限问题
    worker_pool="threads",
    worker_concurrency=4,
)