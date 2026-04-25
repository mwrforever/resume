from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
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


Base = declarative_base()

from .sys_user import SysUser
from .sys_employee import SysEmployee
from .resume import Resume
from .job_position import JobPosition
from .job_eval_dimension import JobEvalDimension
from .job_skill import JobSkill
from .job_application import JobApplication
from .resume_job_match import ResumeJobMatch
from .resume_eval_detail import ResumeEvalDetail
from .resume_skill_hit import ResumeSkillHit
from .sys_dept import SysDept
from .sys_tag import SysTag
from .job_position_tag import JobPositionTag

__all__ = ["Base", "SysUser", "async_session_maker","SysEmployee", "Resume", "JobPosition", "JobEvalDimension", "JobSkill", "JobApplication", "ResumeJobMatch", "ResumeEvalDetail", "ResumeSkillHit", "SysDept", "SysTag", "JobPositionTag"]
