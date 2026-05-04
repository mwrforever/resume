from contextlib import asynccontextmanager
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
            password=settings.DB_PASSWORD,
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