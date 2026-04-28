from pydantic import BaseModel


class ResumeIdRequest(BaseModel):
    resume_id: int
