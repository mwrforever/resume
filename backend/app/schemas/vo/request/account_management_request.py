from typing import Optional

from pydantic import BaseModel, EmailStr


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
