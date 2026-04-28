from datetime import datetime
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class BaseItem(BaseModel):
    class Config:
        from_attributes = True


class TagItem(BaseModel):
    id: int
    tag_name: str
    tag_type: int
    sort_order: int = 0
    status: int = 1
    color: str

    class Config:
        from_attributes = True


class JobItem(BaseItem):
    id: int
    name: str
    description: Optional[str] = None
    template_id: Optional[int] = None
    status: int
    dept_name: Optional[str] = None
    dept_code: Optional[str] = None
    create_time: Optional[datetime] = None
    resume_count: int = 0
    skills: list[str] = []


class JobDetail(BaseItem):
    id: int
    name: str
    description: Optional[str] = None
    template_id: Optional[int] = None
    status: int
    create_time: Optional[datetime] = None
    skills: list[str] = []
    applied: bool = False
    application_id: Optional[int] = None


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


class AiSuggestDimension(BaseModel):
    dimension_name: str
    weight: float
    prompt_template: str


class AiSuggestResponse(BaseModel):
    comprehensive_description: str
    dimensions: list[AiSuggestDimension]
    skills: list[SkillSuggestItem]


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
