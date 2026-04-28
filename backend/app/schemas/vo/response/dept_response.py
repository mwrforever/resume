from datetime import datetime
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class DeptItem(BaseModel):
    id: int
    parent_id: int = 0
    parent_name: Optional[str] = None
    dept_code: str
    dept_name: str
    leader_id: Optional[int] = None
    leader_name: Optional[str] = None
    employee_count: int = 0
    sort_order: int = 0
    status: int = 1
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None

    class Config:
        from_attributes = True


class DeptImportError(BaseModel):
    line: int
    message: str


class DeptImportResult(BaseModel):
    success_count: int
    fail_count: int
    errors: list[DeptImportError]


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
