import os

from celery import Celery
from app.core.config import configure_logging, get_settings

settings = get_settings()
configure_logging(settings)
os.environ["CELERY_BROKER_URL"] = settings.celery_broker_url
os.environ.pop("CELERY_RESULT_BACKEND", None)


celery_app = Celery(
    "resume_platform",
    broker=settings.celery_broker_url,
    backend=None,
    include=["celery_app.tasks.eval_task"]
)

celery_app.conf.update(
    broker_url=settings.celery_broker_url,
    result_backend=None,
    task_ignore_result=True,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    broker_connection_retry=True,
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=None,
    broker_pool_limit=10,
    broker_transport_options={
        "socket_timeout": 30,
        "socket_connect_timeout": 10,
        "socket_keepalive": True,
        "retry_on_timeout": True,
        "health_check_interval": 30,
        "visibility_timeout": 3600,
    },
    task_routes={
        "celery_app.tasks.eval_task.*": {"queue": "eval"}
    },
    # Windows 兼容设置：使用 threads 池避免 spawn 多进程的权限问题
    worker_pool="threads",
    worker_concurrency=4,
)