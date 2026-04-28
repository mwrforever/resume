from typing import Optional

from pydantic import BaseModel


class EvaluationDimensionDTO(BaseModel):
    dimension_id: int
    dimension_name: str
    score: float
    advantage: str
    disadvantage: str
    is_completed: bool
    error_message: Optional[str] = None


class EvaluationSkillHitDTO(BaseModel):
    skill_id: int
    skill_name: Optional[str] = None
    skill_type: Optional[int] = None
    is_hit: bool
    hit_context: str
    match_label: Optional[str] = None


class EvaluationDetailDTO(BaseModel):
    match_id: int
    application_id: int
    resume_id: int
    job_id: int
    final_score: float
    final_label: str
    advantage_comment: str
    disadvantage_comment: str
    dimensions: list[EvaluationDimensionDTO]
    skill_hits: list[EvaluationSkillHitDTO]
