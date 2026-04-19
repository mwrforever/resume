from pydantic import BaseModel
from typing import Optional


class JobCreate(BaseModel):
    name: str
    description: Optional[str] = None
    dept_id: int


class JobUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[int] = None


class JobResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    dept_id: int
    status: int
    create_time: Optional[str]

    class Config:
        from_attributes = True


class SkillSuggestRequest(BaseModel):
    name: str
    description: str


class SkillSuggestItem(BaseModel):
    skill: str
    type: int  # 1=必须, 2=优先, 3=普通
    reason: str
