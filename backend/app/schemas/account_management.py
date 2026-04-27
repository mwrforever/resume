from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class ManagedUserItem(BaseModel):
    id: int
    email: str
    real_name: str
    status: int
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None

    class Config:
        from_attributes = True


class ManagedUserCreate(BaseModel):
    email: EmailStr
    real_name: str
    password: str
    status: int = 1


class ManagedUserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    real_name: Optional[str] = None
    password: Optional[str] = None
    status: Optional[int] = None


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


class ManagedEmployeeCreate(BaseModel):
    emp_no: str
    real_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    dept_id: int = 0
    dept_ids: Optional[list[int]] = None
    primary_dept_id: Optional[int] = None
    status: int = 1


class ManagedEmployeeUpdate(BaseModel):
    emp_no: Optional[str] = None
    real_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    phone: Optional[str] = None
    dept_id: Optional[int] = None
    dept_ids: Optional[list[int]] = None
    primary_dept_id: Optional[int] = None
    status: Optional[int] = None
