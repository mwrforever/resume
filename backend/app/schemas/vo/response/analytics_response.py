from pydantic import BaseModel

from app.schemas.common import ApiResponse, PageData


class DashboardStatsResponse(BaseModel):
    job_count: int
    resume_count: int
    pending_eval_count: int
    avg_match_score: float
    recent_activities: list[dict]


