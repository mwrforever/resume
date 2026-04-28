from typing import Optional

from pydantic import BaseModel, EmailStr


class SendCodeRequest(BaseModel):
    email: EmailStr
    user_type: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    code: str
    real_name: str


class LoginRequest(BaseModel):
    identifier: str
    login_type: str
    password: Optional[str] = None
    code: Optional[str] = None


class EmployeeRegisterRequest(BaseModel):
    emp_no: str
    email: EmailStr
    password: str
    code: str
    real_name: str
    dept_id: Optional[int] = 1


class EmployeeLoginRequest(BaseModel):
    identifier: str
    login_type: str
    password: Optional[str] = None
    code: Optional[str] = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str

__all__ = ["SendCodeRequest", "RegisterRequest", "LoginRequest", "EmployeeRegisterRequest", "EmployeeLoginRequest", "RefreshTokenRequest"]
