from pydantic import BaseModel
from typing import Optional


class ApplyRequest(BaseModel):
    job_id: int
    resume_id: int


class ApplicationResponse(BaseModel):
    id: int
    user_id: int
    job_id: int
    resume_id: int
    status: int
    create_time: Optional[str]

    class Config:
        from_attributes = True


class ApplicationWithDetailResponse(BaseModel):
    id: int
    job_id: int
    job_name: str
    resume_id: int
    resume_name: str
    status: int
    status_name: str
    create_time: Optional[str]
    evaluation: Optional[dict] = None  # 如果已评估，包含评估结果

    class Config:
        from_attributes = True