from datetime import datetime
from typing import Optional

from pydantic import BaseModel


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


class DeptCreate(BaseModel):
    parent_id: int = 0
    dept_code: str
    dept_name: str
    leader_id: Optional[int] = None
    sort_order: int = 0
    status: int = 1


class DeptUpdate(BaseModel):
    parent_id: Optional[int] = None
    dept_code: Optional[str] = None
    dept_name: Optional[str] = None
    leader_id: Optional[int] = None
    sort_order: Optional[int] = None
    status: Optional[int] = None


class DeptImportError(BaseModel):
    line: int
    message: str


class DeptImportResult(BaseModel):
    success_count: int
    fail_count: int
    errors: list[DeptImportError]
