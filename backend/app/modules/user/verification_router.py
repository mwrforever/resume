from typing import Any

from fastapi import APIRouter, Depends, Request

from app.services.cache_service import get_cache, CacheService
from app.utils.verification import send_verification_code
from app.schemas.vo.request.auth_request import SendCodeRequest

router = APIRouter()


@router.post("/send-code")
async def send_code(
    req: SendCodeRequest,
    request: Request,
    cache: CacheService = Depends(get_cache),
) -> dict[str, Any]:
    ip = request.client.host if request.client else "unknown"
    await send_verification_code(req.email, req.user_type, ip, cache)
    return {"code": 200, "message": "验证码已发送", "data": None}
