from pydantic import BaseModel, field_validator
from typing import Optional, List


class DimensionCreate(BaseModel):
    dimension_name: str
    weight: float
    prompt_template: str = ""
    sort_order: int = 0


class DimensionItem(BaseModel):
    id: int
    dimension_name: str
    weight: float
    prompt_template: str
    sort_order: int

    class Config:
        from_attributes = True


class SkillCreate(BaseModel):
    skill_name: str
    skill_type: int  # 1=必须, 2=优先, 3=普通
    match_label: Optional[str] = None


class SkillItem(BaseModel):
    id: int
    skill_name: str
    skill_type: int
    match_label: Optional[str] = None

    class Config:
        from_attributes = True


class TagItem(BaseModel):
    id: int
    tag_name: str
    tag_type: int
    color: str

    class Config:
        from_attributes = True


class JobCreate(BaseModel):
    name: str
    description: Optional[str] = None
    dept_id: int
    dimensions: List[DimensionCreate] = []
    skills: List[SkillCreate] = []
    tag_ids: List[int] = []

    @field_validator("dimensions")
    @classmethod
    def at_least_one_dimension(cls, v: list) -> list:
        if len(v) < 1:
            raise ValueError("至少需要一个评估维度")
        return v


class JobUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None
    tag_ids: Optional[List[int]] = None


class JobResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    dept_id: int
    status: int
    create_time: Optional[str]

    class Config:
        from_attributes = True


class SkillSuggestRequest(BaseModel):
    name: str
    description: str


class SkillSuggestItem(BaseModel):
    skill: str
    type: int  # 1=必须, 2=优先, 3=普通
    reason: str


class AiSuggestRequest(BaseModel):
    name: str
    description: str


class AiSuggestDimension(BaseModel):
    dimension_name: str
    weight: float
    prompt_template: str


class AiSuggestResponse(BaseModel):
    comprehensive_description: str
    dimensions: List[AiSuggestDimension]
    skills: List[SkillSuggestItem]
