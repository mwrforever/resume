from contextlib import asynccontextmanager
import logging
from typing import AsyncGenerator, Optional

from sqlalchemy import select, text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.core.security import get_password_hash
from app.models import Base
from app.models.sys_employee import SysEmployee

logger = logging.getLogger(__name__)


async def _ensure_initial_admin(conn: AsyncConnection) -> None:
    """空库初始化：当 sys_employee 没有任何管理员时，按 .env 配置创建一个。

    场景：首次部署 / 全新环境拉起，避免没有可用账号能进员工管理 / 模型配置等管理页。
    已有任意 is_admin=1 的员工时跳过；不做"按邮箱回填"之类的迁移动作。
    """
    if not settings.INIT_ADMIN_EMAIL or not settings.init_admin_password:
        logger.info("未配置 INIT_ADMIN_EMAIL/INIT_ADMIN_PASSWORD，跳过初始管理员引导")
        return
    result = await conn.execute(
        select(SysEmployee.id).where(SysEmployee.is_admin == 1, SysEmployee.is_deleted == 0).limit(1)
    )
    if result.first() is not None:
        return
    password_hash = get_password_hash(settings.init_admin_password)
    await conn.execute(
        SysEmployee.__table__.insert().values(
            emp_no=settings.INIT_ADMIN_EMP_NO or None,
            real_name=settings.INIT_ADMIN_REAL_NAME,
            email=settings.INIT_ADMIN_EMAIL,
            password_hash=password_hash,
            status=1,
            is_admin=1,
            is_deleted=0,
        )
    )
    logger.info("已根据 .env 创建初始管理员：email=%s", settings.INIT_ADMIN_EMAIL)


# resume_job_match 旧库列默认值兜底：早期建表时 ORM 仅有 Python default、
# 没有 server_default，DB 层面无 DEFAULT。celery 评估任务走的是裸 SQL INSERT
# (绕过 ORM Python default)，缺一列就 1364；按项目既有"幂等 ALTER"风格补默认值。
_RESUME_JOB_MATCH_COLUMN_DEFAULTS: dict[str, str] = {
    "final_score": "ALTER TABLE resume_job_match MODIFY COLUMN final_score DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT '最终得分'",
    "final_label": "ALTER TABLE resume_job_match MODIFY COLUMN final_label VARCHAR(20) NOT NULL DEFAULT '未达标' COMMENT '最终标签'",
    "is_direct_preferred": "ALTER TABLE resume_job_match MODIFY COLUMN is_direct_preferred INT NOT NULL DEFAULT 0 COMMENT '是否直接优选'",
}


async def _ensure_resume_job_match_defaults(conn: AsyncConnection) -> None:
    """旧库 resume_job_match 的 NOT NULL 列若无 DEFAULT 则补上。

    create_all 不会改既有表，新加的 server_default 只对新建库生效；既有部署需要
    这条 ALTER 兜底，否则裸 SQL INSERT 触发 MySQL 1364。SHOW COLUMNS 探测 Default
    字段，仅当为 NULL 时才下发 MODIFY，幂等。
    """
    table_check = await conn.execute(text("SHOW TABLES LIKE 'resume_job_match'"))
    if table_check.first() is None:
        return
    for column, alter_sql in _RESUME_JOB_MATCH_COLUMN_DEFAULTS.items():
        row = await conn.execute(text(f"SHOW COLUMNS FROM resume_job_match LIKE '{column}'"))
        info = row.mappings().first()
        if info is None:
            continue
        # MySQL SHOW COLUMNS 的 Default 字段：无默认值时为 NULL（不区分大小写键名）
        current_default = info.get("Default") if "Default" in info else info.get("default")
        if current_default is None:
            await conn.execute(text(alter_sql))
            logger.info("补齐 resume_job_match 列默认值：%s", column)


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
        """初始化 SQLAlchemy AsyncEngine 并自动建表 + 初始管理员引导。

        ORM `metadata.create_all` 幂等：表已存在不会重建，缺失才建。所有列定义
        以 ORM 模型为唯一来源，不维护任何 ALTER 增量；列变更应通过统一的迁移
        工具进行（如 alembic），或在开发期直接重建库。
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
            # 由 ORM metadata 一次性建出所有表与索引；空库则同步引导初始管理员
            await conn.run_sync(Base.metadata.create_all)
            await _ensure_resume_job_match_defaults(conn)
            await _ensure_initial_admin(conn)

    async def close_pool(self) -> None:
        """关闭 SQLAlchemy AsyncEngine 连接池。"""
        if self._engine is None:
            return

        await self._engine.dispose()
        self._engine = None
        self._session_factory = None

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """获取 ORM Session，适合大部分业务 CRUD。"""
        async with self.session_factory() as session:
            yield session

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[AsyncSession, None]:
        """获取带事务的 ORM Session，成功自动 commit，异常自动 rollback。"""
        async with self.session_factory() as session:
            async with session.begin():
                yield session

    @asynccontextmanager
    async def connection(self) -> AsyncGenerator[AsyncConnection, None]:
        """获取底层连接，适合执行纯 SQL、健康检查、少量不走 ORM 的场景。"""
        async with self.engine.connect() as conn:
            yield conn

    async def health_check(self) -> bool:
        """数据库健康检查。"""
        async with self.connection() as conn:
            result = await conn.execute(text("SELECT 1"))
            return result.scalar_one() == 1


mysql_manager = MySQLManager()
