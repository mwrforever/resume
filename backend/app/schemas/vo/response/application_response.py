from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import ApiResponse, PageData


class BaseItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)


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
    user_real_name: Optional[str] = None
    job_id: int
    job_name: str = ""
    job_snapshot: Optional[dict] = None
    resume_id: int
    resume_file_name: Optional[str] = None
    match_id: Optional[int] = None
    status: int
    status_name: str
    create_time: Optional[datetime] = None

