import logging
import random

from fastapi import HTTPException

from app.infrastructure.cache import get_cache, CacheService
from app.utils.email.email_service import send_verification_email

logger = logging.getLogger(__name__)


def _generate_code() -> str:
    return str(random.randint(100000, 999999))


async def send_verification_code(
    email: str,
    user_type: str,
    ip: str,
    cache: CacheService,
) -> None:
    cooldown_ok = await cache.check_send_cooldown(user_type, email)
    if not cooldown_ok:
        raise HTTPException(status_code=429, detail="发送太频繁，请稍后再试")

    ip_ok = await cache.check_ip_count(ip, limit=5)
    if not ip_ok:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    code = _generate_code()
    await cache.store_code(user_type, email, code)
    await send_verification_email(email, code)


async def verify_and_consume_code(
    email: str,
    user_type: str,
    code: str,
    cache: CacheService,
) -> None:
    result = await cache.verify_code(user_type, email, code)
    if result == -1:
        raise HTTPException(status_code=400, detail="验证码错误或已过期")
    if result == 0:
        raise HTTPException(status_code=400, detail="验证码错误")
