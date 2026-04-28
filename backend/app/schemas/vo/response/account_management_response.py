from datetime import datetime
from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ManagedUserItem(BaseModel):
    id: int
    email: str
    real_name: str
    status: int
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None

    class Config:
        from_attributes = True


class ManagedEmployeeDeptItem(BaseModel):
    dept_id: int
    dept_name: str
    is_primary: int = 0


class ManagedEmployeeItem(BaseModel):
    id: int
    emp_no: Optional[str] = None
    real_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    dept_id: int = 0
    dept_name: Optional[str] = None
    depts: list[ManagedEmployeeDeptItem] = []
    status: int
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None

    class Config:
        from_attributes = True


class PageData(BaseModel):
    total: int
    items: list[Any]


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None
