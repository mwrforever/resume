from fastapi import APIRouter, Depends, Request

from pydantic import BaseModel

from app.deps import get_cache
from app.schemas.common import ApiResponse
from app.services.cache_service import CacheService
from app.utils.verification import send_verification_code

router = APIRouter()


class SendCodeRequest(BaseModel):
    email: str
    user_type: str


@router.post("/send-code", response_model=ApiResponse)
async def send_code(
    request: Request,
    body: SendCodeRequest,
    cache: CacheService = Depends(get_cache),
):
    ip = request.client.host if request.client else "unknown"
    await send_verification_code(body.email, body.user_type, ip, cache)
    return ApiResponse(message="发送成功")
