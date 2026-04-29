from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import ApiResponse, PageData


class BaseItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)


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


