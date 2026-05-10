from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from contextlib import contextmanager
from sqlalchemy.engine import URL

from app.core.config import settings


class MySQLManagerSync:
    def __init__(self):
        self._engine = None
        self._session_factory = None

    def init_pool(self):
        if self._engine:
            return

        database_url = URL.create(
            drivername="mysql+pymysql",
            username=settings.DB_USER,
            password=settings.db_password,
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            database=settings.DB_NAME,
        )

        self._engine = create_engine(
            database_url,
            pool_size=settings.DB_POOL_MIN_SIZE,
            max_overflow=settings.DB_POOL_MAX_SIZE - settings.DB_POOL_MIN_SIZE,
            pool_recycle=settings.DB_POOL_RECYCLE,
            pool_pre_ping=True,
            future=True,
        )

        self._session_factory = sessionmaker(
            bind=self._engine,
            autoflush=False,
            expire_on_commit=False,
        )

    def _ensure_initialized(self):
        if self._engine is None:
            self.init_pool()

    def _get_session(self):
        self._ensure_initialized()
        return self._session_factory()

    @contextmanager
    def transaction(self):
        session = self._get_session()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


    @contextmanager
    def session(self):
        session = self._get_session()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


mysql_manager_sync = MySQLManagerSync()