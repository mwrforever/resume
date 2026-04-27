from typing import List, Optional

from pydantic import BaseModel


class TagItem(BaseModel):
    id: int
    tag_name: str
    tag_type: int
    sort_order: int = 0
    status: int = 1
    color: str

    class Config:
        from_attributes = True


class TagCreate(BaseModel):
    tag_name: str
    tag_type: int = 1
    sort_order: int = 0
    status: int = 1
    color: str = "default"


class TagUpdate(BaseModel):
    tag_name: Optional[str] = None
    tag_type: Optional[int] = None
    sort_order: Optional[int] = None
    status: Optional[int] = None
    color: Optional[str] = None


class JobCreate(BaseModel):
    name: str
    description: str
    dept_id: int
    template_id: Optional[int] = None


class JobUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    template_id: Optional[int] = None
    status: Optional[int] = None


class JobResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    dept_id: int
    template_id: Optional[int] = None
    status: int
    create_time: Optional[str]

    class Config:
        from_attributes = True


class SkillSuggestItem(BaseModel):
    skill: str
    type: int
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
