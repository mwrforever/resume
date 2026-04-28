from typing import Optional

from pydantic import BaseModel


class TagCreate(BaseModel):
    tag_name: str
    tag_type: int = 1
    sort_order: int = 0
    status: int = 1
    color: str = "default"


class TagUpdate(BaseModel):
    tag_name: Optional[str] = None
    tag_type: Optional[int] = None
    sort_order: Optional[int] = None
    status: Optional[int] = None
    color: Optional[str] = None
