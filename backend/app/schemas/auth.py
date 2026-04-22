from pydantic import BaseModel, EmailStr
from typing import Optional


class SendCodeRequest(BaseModel):
    email: EmailStr
    user_type: str  # "user" or "employee"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    code: str
    real_name: str


class LoginRequest(BaseModel):
    identifier: str  # username or email
    login_type: str  # "password" or "code"
    password: Optional[str] = None
    code: Optional[str] = None


class EmployeeLoginRequest(BaseModel):
    identifier: str  # emp_no or email
    login_type: str  # "password" or "code"
    password: Optional[str] = None
    code: Optional[str] = None


class EmployeeRegisterRequest(BaseModel):
    emp_no: str  # 员工工号
    email: EmailStr
    password: str
    code: str
    real_name: str
    dept_id: Optional[int] = 1


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_type: str
    user_id: int
