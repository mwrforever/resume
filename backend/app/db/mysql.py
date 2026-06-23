from contextlib import asynccontextmanager
import logging
from typing import AsyncGenerator, Optional

from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.models import Base

logger = logging.getLogger(__name__)


LLM_MODEL_CONFIG_SCHEMA_COLUMNS = {
    "fallback_model_name": "ALTER TABLE llm_model_config ADD COLUMN fallback_model_name VARCHAR(100) DEFAULT NULL COMMENT '兜底模型名称' AFTER model_name",
    "extra_body": "ALTER TABLE llm_model_config ADD COLUMN extra_body JSON DEFAULT NULL COMMENT '扩展参数' AFTER fallback_model_name",
    "enable_thinking": "ALTER TABLE llm_model_config ADD COLUMN enable_thinking TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否开启思考模式' AFTER extra_body",
    "enable_tools": "ALTER TABLE llm_model_config ADD COLUMN enable_tools TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用工具调用' AFTER enable_thinking",
    "enable_prompt_cache": "ALTER TABLE llm_model_config ADD COLUMN enable_prompt_cache TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用LLM前缀缓存' AFTER enable_tools",
    "enable_memory": "ALTER TABLE llm_model_config ADD COLUMN enable_memory TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用上下文记忆' AFTER enable_prompt_cache",
    "temperature": "ALTER TABLE llm_model_config ADD COLUMN temperature DECIMAL(4, 2) NOT NULL DEFAULT 0.70 COMMENT '生成随机性' AFTER enable_memory",
    "top_p": "ALTER TABLE llm_model_config ADD COLUMN top_p DECIMAL(4, 2) NOT NULL DEFAULT 0.90 COMMENT '核采样参数' AFTER temperature",
    "max_tokens": "ALTER TABLE llm_model_config ADD COLUMN max_tokens INT NOT NULL DEFAULT 2048 COMMENT '最大输出Token' AFTER top_p",
    "presence_penalty": "ALTER TABLE llm_model_config ADD COLUMN presence_penalty DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT '话题出现惩罚' AFTER max_tokens",
    "frequency_penalty": "ALTER TABLE llm_model_config ADD COLUMN frequency_penalty DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT '频率惩罚' AFTER presence_penalty",
    "timeout_seconds": "ALTER TABLE llm_model_config ADD COLUMN timeout_seconds SMALLINT NOT NULL DEFAULT 120 COMMENT '请求超时时间' AFTER frequency_penalty",
    "max_retries": "ALTER TABLE llm_model_config ADD COLUMN max_retries SMALLINT NOT NULL DEFAULT 2 COMMENT '最大重试次数' AFTER timeout_seconds",
    "status": "ALTER TABLE llm_model_config ADD COLUMN status SMALLINT NOT NULL DEFAULT 1 COMMENT '状态：1启用，0停用' AFTER max_retries",
    "is_deleted": "ALTER TABLE llm_model_config ADD COLUMN is_deleted BIGINT NOT NULL DEFAULT 0 COMMENT '软删除标记：0未删除，删除时写入Unix微秒时间戳' AFTER status",
    "last_test_at": "ALTER TABLE llm_model_config ADD COLUMN last_test_at DATETIME DEFAULT NULL COMMENT '最近测试时间' AFTER is_deleted",
    "last_test_status": "ALTER TABLE llm_model_config ADD COLUMN last_test_status SMALLINT DEFAULT NULL COMMENT '最近测试状态' AFTER last_test_at",
    "last_test_message": "ALTER TABLE llm_model_config ADD COLUMN last_test_message VARCHAR(500) DEFAULT NULL COMMENT '最近测试结果' AFTER last_test_status",
}


async def ensure_llm_model_config_schema(conn: AsyncConnection) -> None:
    for column_name, alter_sql in LLM_MODEL_CONFIG_SCHEMA_COLUMNS.items():
        column_result = await conn.execute(text(f"SHOW COLUMNS FROM llm_model_config LIKE '{column_name}'"))
        if column_result.first():
            continue
        logger.info("LLM模型配置表缺少字段，正在自动补齐：column=%s", column_name)
        await conn.execute(text(alter_sql))


# sys_employee 表的增量字段：is_admin 用于员工管理员分类（替代写死邮箱判定）。
# 仅在旧库缺列时自动补齐；新增列默认 0，并把已知旧管理员邮箱置位为 1，
# 避免迁移后无人有权限进入员工管理（权限自举死锁）。
SYS_EMPLOYEE_SCHEMA_COLUMNS = {
    "is_admin": "ALTER TABLE sys_employee ADD COLUMN is_admin SMALLINT NOT NULL DEFAULT 0 COMMENT '是否管理员：1是，0否' AFTER status",
}

# 迁移时一次性置位为管理员的旧账号邮箱（仅用于数据回填，ensure_admin 不再依赖此值）。
LEGACY_ADMIN_EMAIL = "18229923842@163.com"


async def ensure_sys_employee_schema(conn: AsyncConnection) -> None:
    """补齐 sys_employee 增量字段，并把旧管理员邮箱回填为 is_admin=1。"""
    for column_name, alter_sql in SYS_EMPLOYEE_SCHEMA_COLUMNS.items():
        column_result = await conn.execute(text(f"SHOW COLUMNS FROM sys_employee LIKE '{column_name}'"))
        if column_result.first():
            continue
        logger.info("sys_employee 表缺少字段，正在自动补齐：column=%s", column_name)
        await conn.execute(text(alter_sql))
        # 新增 is_admin 列后，把旧管理员邮箱置位为 1，保证迁移后仍有可用管理员。
        # LEGACY_ADMIN_EMAIL 为内部写死常量（非用户输入），内联拼接无注入风险，
        # 且与同文件其它迁移语句风格一致（均走 text(sql) 无绑定参数）。
        if column_name == "is_admin":
            await conn.execute(text(
                f"UPDATE sys_employee SET is_admin = 1 WHERE email = '{LEGACY_ADMIN_EMAIL}' AND is_deleted = 0"
            ))
            logger.info("已将旧管理员邮箱置位 is_admin=1：email=%s", LEGACY_ADMIN_EMAIL)


# agent_message 表的增量字段：task_id 用于续接判断（详见 agent_runtime_service 注释）。
# 旧消息为 NULL，被视为已完成、不参与续接，行为与历史一致；新消息记录落库时的 thread_id。
AGENT_MESSAGE_SCHEMA_COLUMNS = {
    "task_id": "ALTER TABLE agent_message ADD COLUMN task_id VARCHAR(64) NULL COMMENT '落库时的 thread_id，用于续接判断' AFTER run_id",
}


async def ensure_agent_message_schema(conn: AsyncConnection) -> None:
    """幂等补齐 agent_message 增量字段。"""
    for column_name, alter_sql in AGENT_MESSAGE_SCHEMA_COLUMNS.items():
        column_result = await conn.execute(text(f"SHOW COLUMNS FROM agent_message LIKE '{column_name}'"))
        if column_result.first():
            continue
        logger.info("agent_message 表缺少字段，正在自动补齐：column=%s", column_name)
        await conn.execute(text(alter_sql))


class MySQLManager:
    def __init__(self) -> None:
        self._engine: Optional[AsyncEngine] = None
        self._session_factory: Optional[async_sessionmaker[AsyncSession]] = None

    @property
    def engine(self) -> AsyncEngine:
        if self._engine is None:
            raise RuntimeError("MySQL engine has not been initialized")
        return self._engine

    @property
    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        if self._session_factory is None:
            raise RuntimeError("MySQL session factory has not been initialized")
        return self._session_factory

    async def init_pool(self) -> None:
        """
        初始化 SQLAlchemy AsyncEngine。

        这里保留 init_pool 这个方法名，方便你少改 FastAPI lifespan 里的调用。
        """
        if self._engine is not None:
            return

        database_url = URL.create(
            drivername="mysql+aiomysql",
            username=settings.DB_USER,
            password=settings.db_password,
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            database=settings.DB_NAME,
            query={
                "charset": settings.DB_CHARSET,
            },
        )

        self._engine = create_async_engine(
            database_url,
            pool_size=settings.DB_POOL_MIN_SIZE,
            max_overflow=settings.DB_POOL_MAX_SIZE - settings.DB_POOL_MIN_SIZE,
            pool_recycle=settings.DB_POOL_RECYCLE,
            pool_pre_ping=True,
            pool_timeout=settings.DB_POOL_TIMEOUT,
            connect_args={
                "connect_timeout": settings.DB_CONNECT_TIMEOUT,
                "autocommit": False,
            },
            echo=settings.DEBUG,
        )

        self._session_factory = async_sessionmaker(
            bind=self._engine,
            class_=AsyncSession,
            autoflush=False,
            expire_on_commit=False,
        )
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await ensure_llm_model_config_schema(conn)
            await ensure_sys_employee_schema(conn)
            await ensure_agent_message_schema(conn)

    async def close_pool(self) -> None:
        """
        关闭 SQLAlchemy AsyncEngine 连接池。
        """
        if self._engine is None:
            return

        await self._engine.dispose()
        self._engine = None
        self._session_factory = None

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """
        获取 ORM Session。

        适合大部分业务 CRUD。
        """
        async with self.session_factory() as session:
            yield session

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[AsyncSession, None]:
        """
        获取带事务的 ORM Session。

        成功自动 commit，异常自动 rollback。
        """
        async with self.session_factory() as session:
            async with session.begin():
                yield session

    @asynccontextmanager
    async def connection(self) -> AsyncGenerator[AsyncConnection, None]:
        """
        获取底层连接。

        适合执行纯 SQL、健康检查、少量不走 ORM 的场景。
        """
        async with self.engine.connect() as conn:
            yield conn

    async def health_check(self) -> bool:
        """
        数据库健康检查。
        """
        async with self.connection() as conn:
            result = await conn.execute(text("SELECT 1"))
            return result.scalar_one() == 1


mysql_manager = MySQLManager()