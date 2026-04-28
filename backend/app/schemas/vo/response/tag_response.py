from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class TagItem(BaseModel):
    id: int
    tag_name: str
    tag_type: int
    sort_order: int = 0
    status: int = 1
    color: str

    class Config:
        from_attributes = True


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
