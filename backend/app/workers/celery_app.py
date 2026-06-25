from celery import Celery
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.workers.db.sync_mysql import mysql_manager_sync
from app.workers.db.sync_redis import redis_manager_sync

settings = get_settings()
configure_logging(settings)


# 任务模块 → 队列名映射（注册新任务模块时同步加这里，启动脚本会读取以决定 worker 消费哪些队列）。
# 单一来源：task_routes 由本字典派生，新增任务模块只需改这一处。
TASK_QUEUE_ROUTES: dict[str, str] = {
    "app.workers.tasks.eval_task": "eval",
    "app.workers.tasks.agent_task": "agent",
}
# 启动脚本会调用 `python -c "from app.workers.celery_app import ALL_QUEUES; print(ALL_QUEUES)"`
ALL_QUEUES: str = ",".join(sorted(set(TASK_QUEUE_ROUTES.values())))


celery_app = Celery(
    "resume_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=list(TASK_QUEUE_ROUTES),
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
    task_routes={f"{module}.*": {"queue": queue} for module, queue in TASK_QUEUE_ROUTES.items()},
    # Windows 兼容设置：使用 threads 池避免 spawn 多进程的权限问题
    worker_pool="threads",
    worker_concurrency=4,
)

# app/celery/app.py


@celery_app.on_after_configure.connect
def init_db(**kwargs):

    mysql_manager_sync.init_pool()
    redis_manager_sync.init_client()
