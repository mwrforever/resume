from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def async_session():
    async with async_session_maker() as session:
        yield session


Base = declarative_base()

from .sys_user import SysUser
from .sys_employee import SysEmployee
from .resume import Resume
from .job_position import JobPosition
from .job_eval_dimension import JobEvalDimension
from .job_skill import JobSkill

__all__ = ["Base", "async_session", "SysUser", "SysEmployee", "Resume", "JobPosition", "JobEvalDimension", "JobSkill"]
