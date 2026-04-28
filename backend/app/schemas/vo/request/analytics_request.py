from pydantic import BaseModel


class JobAnalyticsRequest(BaseModel):
    job_id: int
