"""LangGraph 编排 State 实体（强类型 Pydantic，供 Checkpoint 序列化与节点读写）。"""



from typing import Any, Self



from pydantic import BaseModel, ConfigDict, Field, field_validator



from app.schemas.agent.dto import (

    AgentToolCallDTO,

    AgentToolContextDTO,

    AgentToolResultDTO,

    LLMRuntimeConfigDTO,

)

from app.schemas.agent.enums import AgentDomain, PlanReviewStatus, SubTaskStatus





class ResumeContextDTO(BaseModel):
    """Agent 会话附带的简历上下文（上传后由编排节点逐步填充）。"""

    resume_id: int
    job_id: int
    file_name: str = ""
    file_path: str = ""
    raw_text: str = ""
    structured_markdown: str = ""


class SubTaskDTO(BaseModel):

    """规划子任务。"""



    model_config = ConfigDict(use_enum_values=False)



    task_id: str

    domain: AgentDomain

    title: str

    instruction: str

    depends_on: list[str] = Field(default_factory=list)

    status: SubTaskStatus = SubTaskStatus.PENDING

    result_summary: str | None = None





class OrchestratorState(BaseModel):

    """

    编排图共享 State 实体。



    - LangGraph 使用 ``StateGraph(OrchestratorState)`` 注册，节点入参为实体本身。

    - ``configurable.thread_id`` 必须使用 ``agent_session.session_key``，与会话一一对应。

    - Checkpoint 落盘为 JSON 兼容 dict，读取时通过 ``from_checkpoint`` 还原为实体。

    """



    model_config = ConfigDict(validate_assignment=True, use_enum_values=False)



    session_id: int

    session_key: str

    employee_id: int

    user_input: str = ""

    prompt: str = ""

    runtime_config: LLMRuntimeConfigDTO

    tool_context: AgentToolContextDTO = Field(default_factory=AgentToolContextDTO)



    analysis_ready: bool = True

    analysis_summary: str | None = None

    # 简历附件链路：prepare → extract(工具) → markdown(Agent) → analyst
    has_resume_attachment: bool = False
    resume_context: ResumeContextDTO | None = None



    plan_revision: int = 0

    max_plan_revisions: int = 5

    plan_draft: list[SubTaskDTO] = Field(default_factory=list)

    plan_tasks: list[SubTaskDTO] = Field(default_factory=list)

    plan_review_status: PlanReviewStatus = PlanReviewStatus.PENDING

    plan_review_feedback: str | None = None

    plan_repair_suggestions: list[str] = Field(default_factory=list)



    final_content: str = ""

    error_message: str | None = None

    tool_calls: list[AgentToolCallDTO] = Field(default_factory=list)

    tool_results: list[AgentToolResultDTO] = Field(default_factory=list)



    @field_validator("runtime_config", mode="before")

    @classmethod

    def _coerce_runtime_config(cls, value: Any) -> Any:

        """兼容 Checkpoint 中的 dict 形态 runtime_config。"""

        if value is None:

            raise ValueError("runtime_config 不能为空")

        if isinstance(value, LLMRuntimeConfigDTO):

            return value

        return value



    @field_validator("tool_context", mode="before")

    @classmethod

    def _coerce_tool_context(cls, value: Any) -> Any:

        if value is None:

            return AgentToolContextDTO()

        return value



    @field_validator("resume_context", mode="before")
    @classmethod
    def _coerce_resume_context(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, ResumeContextDTO):
            return value
        return ResumeContextDTO.model_validate(value)

    @field_validator("plan_draft", "plan_tasks", mode="before")

    @classmethod

    def _coerce_subtasks(cls, value: Any) -> Any:

        if not value:

            return []

        return [

            item if isinstance(item, SubTaskDTO) else SubTaskDTO.model_validate(item)

            for item in value

        ]



    @field_validator("tool_calls", mode="before")

    @classmethod

    def _coerce_tool_calls(cls, value: Any) -> Any:

        if not value:

            return []

        return [

            item if isinstance(item, AgentToolCallDTO) else AgentToolCallDTO.model_validate(item)

            for item in value

        ]



    @field_validator("tool_results", mode="before")

    @classmethod

    def _coerce_tool_results(cls, value: Any) -> Any:

        if not value:

            return []

        return [

            item if isinstance(item, AgentToolResultDTO) else AgentToolResultDTO.model_validate(item)

            for item in value

        ]



    @classmethod

    def coerce(cls, state: Self | dict[str, Any] | Any) -> Self:

        """

        将 LangGraph 节点入参或局部 dict 转为 State 实体。



        节点在 Pydantic StateGraph 下通常已收到实体；Checkpoint 读取为 dict 时需显式转换。

        """

        if isinstance(state, cls):

            return state

        if hasattr(state, "model_dump") and not isinstance(state, dict):

            return cls.model_validate(state.model_dump(mode="python"))

        return cls.model_validate(state or {})



    @classmethod

    def from_checkpoint(cls, values: dict[str, Any] | None) -> Self:

        """从 LangGraph Checkpoint 的 values 字典还原 State。"""

        if not values:

            raise ValueError("Checkpoint 中不存在可恢复的 State")

        return cls.model_validate(values)



    def tool_context_dict(self) -> dict[str, Any]:

        """供内置工具层使用的 dict 视图（工具接口仍为 dict）。"""

        return self.tool_context.model_dump(mode="python")





# 向后兼容旧命名，新代码优先使用 OrchestratorState

OrchestratorStateDTO = OrchestratorState


