from datetime import datetime
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class BaseItem(BaseModel):
    class Config:
        from_attributes = True


class ApplicationItem(BaseItem):
    id: int
    job_id: int
    job_name: Optional[str] = None
    job_snapshot: Optional[dict] = None
    resume_id: int
    status: int
    status_name: str
    create_time: Optional[datetime] = None


class ApplicationDetail(ApplicationItem):
    user_id: Optional[int] = None
    evaluation: Optional[dict] = None
    resume_name: Optional[str] = None
    resume_file_path: Optional[str] = None


class EmployeeApplicationItem(BaseItem):
    id: int
    user_id: int
    job_id: int
    job_name: str = ""
    job_snapshot: Optional[dict] = None
    resume_id: int
    resume_file_name: Optional[str] = None
    match_id: Optional[int] = None
    status: int
    status_name: str
    create_time: Optional[datetime] = None


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
