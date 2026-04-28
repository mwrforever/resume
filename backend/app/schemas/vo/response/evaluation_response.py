from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class BaseItem(BaseModel):
    class Config:
        from_attributes = True


class EvalResult(BaseItem):
    match_id: int
    application_id: int
    resume_id: int
    job_id: int
    final_score: float
    final_label: str
    advantage_comment: Optional[str] = None
    disadvantage_comment: Optional[str] = None
    dimensions: list[dict]
    skill_hits: list[dict]


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
