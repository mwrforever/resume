from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import ApiResponse, PageData


class EvalDimensionItem(BaseModel):
    id: int
    dimension_name: str
    description: Optional[str] = None
    default_prompt_template: str
    sort_order: int = 0
    status: int = 1
    template_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class EvalDimensionAiSuggestResponse(BaseModel):
    dimension_name: str
    description: str = ""
    default_prompt_template: str = ""


class TemplateDimensionItem(BaseModel):
    id: Optional[int] = None
    dimension_id: int
    dimension_name: str
    weight: float
    prompt_template: str
    sort_order: int = 0


class TemplateSkillItem(BaseModel):
    id: Optional[int] = None
    skill_name: str
    skill_type: int
    match_label: Optional[str] = None
    is_ai_generated: Optional[int] = 0


class TemplateSkillAiSuggestResponse(BaseModel):
    skills: list[TemplateSkillItem] = []


class JobTemplateAiSuggestDimension(BaseModel):
    dimension_name: str
    description: str = ""
    weight: float = 0
    prompt_template: str = ""


class JobTemplateAiSuggestResponse(BaseModel):
    template_name: str
    description: str = ""
    dimensions: list[JobTemplateAiSuggestDimension] = []
    skills: list[TemplateSkillItem] = []


class TemplateTagItem(BaseModel):
    id: int
    tag_name: str
    tag_type: int
    color: str


class EvalTemplateItem(BaseModel):
    id: int
    template_name: str
    description: Optional[str] = None
    status: int
    job_count: int = 0
    published_job_count: int = 0
    dimensions: list[TemplateDimensionItem] = []
    skills: list[TemplateSkillItem] = []
    tags: list[TemplateTagItem] = []

    model_config = ConfigDict(from_attributes=True)

