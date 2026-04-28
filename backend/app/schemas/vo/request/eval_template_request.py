from typing import Optional

from pydantic import BaseModel


class EvalDimensionCreate(BaseModel):
    dimension_name: str
    description: Optional[str] = None
    default_prompt_template: str = ""
    sort_order: int = 0
    status: int = 1


class EvalDimensionUpdate(BaseModel):
    dimension_name: Optional[str] = None
    description: Optional[str] = None
    default_prompt_template: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[int] = None


class EvalDimensionAiSuggestRequest(BaseModel):
    job_name: str
    job_description: str = ""


class TemplateDimensionCreate(BaseModel):
    dimension_id: int
    weight: float
    prompt_template: str = ""
    sort_order: int = 0


class TemplateSkillCreate(BaseModel):
    skill_name: str
    skill_type: int
    match_label: Optional[str] = None
    is_ai_generated: int = 0


class TemplateSkillAiSuggestDimension(BaseModel):
    dimension_name: str
    weight: float = 0
    prompt_template: str = ""


class TemplateSkillAiSuggestRequest(BaseModel):
    dimensions: list[TemplateSkillAiSuggestDimension]


class JobTemplateAiSuggestRequest(BaseModel):
    job_name: str
    job_description: str = ""


class EvalTemplateCreate(BaseModel):
    template_name: str
    description: Optional[str] = None
    status: int = 1
    dimensions: list[TemplateDimensionCreate] = []
    skills: list[TemplateSkillCreate] = []
    tag_ids: list[int] = []


class EvalTemplateUpdate(BaseModel):
    template_name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None
    dimensions: Optional[list[TemplateDimensionCreate]] = None
    skills: Optional[list[TemplateSkillCreate]] = None
    tag_ids: Optional[list[int]] = None
