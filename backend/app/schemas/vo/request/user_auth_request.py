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


class RefreshTokenRequest(BaseModel):
    refresh_token: str
