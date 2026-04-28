from typing import Optional

from pydantic import BaseModel


class JobCreate(BaseModel):
    name: str
    description: str
    dept_id: int
    template_id: Optional[int] = None


class JobUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    template_id: Optional[int] = None
    status: Optional[int] = None


class AiSuggestRequest(BaseModel):
    name: str
    description: str
