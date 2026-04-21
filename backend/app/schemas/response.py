from pydantic import BaseModel
from datetime import datetime
from typing import Generic, TypeVar, Optional, Any, List
from fastapi import Response as FastAPIResponse

T = TypeVar("T")


class BaseItem(BaseModel):
    class Config:
        from_attributes = True


class JobItem(BaseItem):
    id: int
    name: str
    description: Optional[str] = None
    status: int
    create_time: Optional[datetime] = None
    skills: list[str] = []


class JobDetail(BaseItem):
    id: int
    name: str
    description: Optional[str] = None
    status: int
    create_time: Optional[datetime] = None
    skills: list[str] = []
    applied: bool = False
    application_id: Optional[int] = None


class ResumeItem(BaseItem):
    id: int
    file_name: str
    status: int
    create_time: Optional[datetime] = None


class ResumeDetail(ResumeItem):
    file_path: str


class ApplicationItem(BaseItem):
    id: int
    job_id: int
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
    resume_id: int
    status: int
    status_name: str
    create_time: Optional[datetime] = None


class EvalResult(BaseItem):
    match_id: int
    final_score: float
    final_label: str
    advantage_comment: Optional[str] = None
    disadvantage_comment: Optional[str] = None
    dimensions: List[dict]
    skill_hits: List[dict]


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
