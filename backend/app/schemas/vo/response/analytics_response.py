from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class DashboardStatsResponse(BaseModel):
    job_count: int
    resume_count: int
    pending_eval_count: int
    avg_match_score: float
    recent_activities: list[dict]


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
