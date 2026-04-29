from typing import Any

import redis
from fastapi import APIRouter, Depends

from app.infrastructure.client import get_redis_client
from app.utils.verification import send_verification_code
from app.schemas.vo.request.auth_request import SendCodeRequest

router = APIRouter()


@router.post("/send-code")
async def send_code(req: SendCodeRequest, r: redis.Redis = Depends(get_redis_client)) -> dict[str, Any]:
    await send_verification_code(req.email, req.user_type, r)
    return {"code": 200, "message": "验证码已发送", "data": None}
