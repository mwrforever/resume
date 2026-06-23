from pydantic import BaseModel

from app.schemas.common import ApiResponse


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_type: str
    user_id: int
    # 是否管理员（仅 employee 有意义，user 恒为 False）；前端据此隐藏管理类菜单
    is_admin: bool = False


class RefreshTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_type: str
    user_id: int
    is_admin: bool = False
