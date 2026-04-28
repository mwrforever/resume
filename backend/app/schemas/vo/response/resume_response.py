from datetime import datetime
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class BaseItem(BaseModel):
    class Config:
        from_attributes = True


class ResumeItem(BaseItem):
    id: int
    file_name: str
    status: int
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    create_time: Optional[datetime] = None


class ResumeDetail(ResumeItem):
    file_path: str


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
