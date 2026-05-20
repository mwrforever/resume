from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass


from .sys_user import SysUser
from .sys_employee import SysEmployee
from .resume import Resume
from .job_position import JobPosition
from .job_application import JobApplication
from .resume_job_match import ResumeJobMatch
from .resume_eval_detail import ResumeEvalDetail
from .resume_skill_hit import ResumeSkillHit
from .sys_dept import SysDept
from .sys_dept_employee import SysDeptEmployee
from .sys_tag import SysTag
from .eval_dimension import EvalDimension
from .eval_template import EvalTemplate
from .eval_template_dimension import EvalTemplateDimension
from .eval_template_skill import EvalTemplateSkill
from .eval_template_tag import EvalTemplateTag
from .llm_model_config import LlmModelConfig
from .agent_session import AgentSession
from .agent_message import AgentMessage
from .agent_memory import AgentMemory

__all__ = ["Base", "SysUser", "SysEmployee", "Resume", "JobPosition",
           "JobApplication", "ResumeJobMatch", "ResumeEvalDetail", "ResumeSkillHit", "SysDept",
           "SysDeptEmployee", "SysTag", "EvalDimension", "EvalTemplate", "EvalTemplateDimension",
           "EvalTemplateSkill", "EvalTemplateTag", "LlmModelConfig", "AgentSession", "AgentMessage",
           "AgentMemory"]
