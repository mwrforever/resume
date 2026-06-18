from pydantic import BaseModel

from app.schemas.common import ApiResponse


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_type: str
    user_id: int


class RefreshTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_type: str
    user_id: int
