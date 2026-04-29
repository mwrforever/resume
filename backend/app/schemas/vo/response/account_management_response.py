from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import ApiResponse, PageData


class ManagedUserItem(BaseModel):
    id: int
    email: str
    real_name: str
    status: int
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)

