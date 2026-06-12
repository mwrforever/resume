"""
Agent / LLM 数据传输对象（精简后版本）。

仅保留两次重构后实际使用的 DTO：
- LLM 调用相关：LLMRuntimeConfigDTO / LLMResultDTO / LLMStreamChunkDTO / TokenUsage
- 业务结构：InterviewQuestionSetDTO 系列、ResumeEvaluationReportDTO

删除（v1 残留）：source / enable_memory / top_p / presence_penalty / frequency_penalty /
enable_prompt_cache / AgentToolCallDTO / AgentToolResultDTO / AgentToolContextDTO /
ResumeContextDTO / ResumeAnalyseState。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


# ====== LLM 调用 ======

LLMProtocol = Literal["openai_compatible"]
LLMProvider = Literal["deepseek", "qwen", "other"]


class LLMRuntimeConfigDTO(BaseModel):
    """LLM 运行时配置（精简版）。"""
    model_config = ConfigDict(extra="forbid")

    # 路由
    protocol: LLMProtocol = "openai_compatible"
    provider: LLMProvider
    base_url: str
    api_key: SecretStr
    model_name: str
    fallback_model_name: str | None = None

    # 运行参数
    temperature: float = 0.7
    max_tokens: int | None = None
    max_retries: int = 1
    timeout_seconds: int = 60

    # 思考模式
    enable_thinking: bool = False
    thinking_budget_tokens: int | None = None


class TokenUsage(BaseModel):
    """Token 使用统计。"""
    model_config = ConfigDict(extra="forbid")
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class LLMResultDTO(BaseModel):
    """非流式调用结果。"""
    content: str
    model_name: str
    usage: TokenUsage = Field(default_factory=TokenUsage)


class LLMStreamChunkDTO(BaseModel):
    """流式增量。同一 chunk 至多承载一种 delta。"""
    model_config = ConfigDict(extra="forbid")
    kind: Literal["text", "thinking", "usage", "done"]
    text_delta: str = ""
    usage: TokenUsage | None = None
    finish_reason: str | None = None


# ====== 业务结构 DTO ======

class InterviewDimensionDTO(BaseModel):
    """AI 提议的面试维度。"""
    name: str
    reason: str
    source: str = "ai"


class InterviewQuestionPlanItemDTO(BaseModel):
    """面试题计划中的单个维度配置。"""
    dimension: str
    question_count: int
    difficulty: str
    focus: str


class InterviewQuestionPlanDTO(BaseModel):
    """面试题生成计划。"""
    total_questions: int
    items: list[InterviewQuestionPlanItemDTO]
    summary: str


class InterviewQuestionItemDTO(BaseModel):
    """单道结构化面试题。"""
    question: str
    dimension: str
    difficulty: str
    evaluation_points: list[str] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(default_factory=list)
    excellent_signals: list[str] = Field(default_factory=list)
    average_signals: list[str] = Field(default_factory=list)
    risk_signals: list[str] = Field(default_factory=list)


class InterviewQuestionSetDTO(BaseModel):
    """最终面试题清单。"""
    title: str = "面试题清单"
    total_questions: int
    dimensions: list[str]
    questions: list[InterviewQuestionItemDTO]


class ResumeEvaluationReportDTO(BaseModel):
    """简历评估报告结构化数据。"""
    final_score: float
    final_label: str
    decision: str
    summary: str
    match_overview: dict[str, Any] = Field(default_factory=dict)
    resume_structure: dict[str, Any] = Field(default_factory=dict)
    experience_timeline: list[dict[str, Any]] = Field(default_factory=list)
    skill_dimensions: list[dict[str, Any]] = Field(default_factory=list)
    job_gaps: list[dict[str, Any]] = Field(default_factory=list)
