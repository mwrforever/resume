from celery import Celery
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.workers.db.sync_mysql import mysql_manager_sync
from app.workers.db.sync_redis import redis_manager_sync

settings = get_settings()
configure_logging(settings)


celery_app = Celery(
    "resume_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.workers.tasks.eval_task",
        "app.workers.tasks.agent_task",
    ],
)

celery_app.conf.update(
    broker_url=settings.celery_broker_url,
    result_backend=settings.celery_result_backend,
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
        "app.workers.tasks.eval_task.*": {"queue": "eval"},
        "app.workers.tasks.agent_task.*": {"queue": "agent"},
    },
    # Windows 兼容设置：使用 threads 池避免 spawn 多进程的权限问题
    worker_pool="threads",
    worker_concurrency=4,
)

# app/celery/app.py


@celery_app.on_after_configure.connect
def init_db(**kwargs):

    mysql_manager_sync.init_pool()
    redis_manager_sync.init_client()
