from pydantic import BaseModel


class ApplyRequest(BaseModel):
    job_id: int
    resume_id: int
