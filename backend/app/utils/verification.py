import random

import redis
from fastapi import HTTPException

from app.utils.email.email_service import send_verification_email

CODE_TTL = 300
COOLDOWN_TTL = 60


def _generate_code() -> str:
    return str(random.randint(100000, 999999))


def _check_send_cooldown(email: str, user_type: str, r: redis.Redis) -> None:
    if r.exists(f"verify_code:{email}:{user_type}:cooldown"):
        raise HTTPException(status_code=429, detail="发送太频繁，请稍后再试")


def _store_code(email: str, user_type: str, r: redis.Redis) -> str:
    code = _generate_code()
    key = f"verify_code:{email}:{user_type}"
    r.setex(key, CODE_TTL, code)
    r.setex(f"{key}:cooldown", COOLDOWN_TTL, "1")
    return code


async def send_verification_code(email: str, user_type: str, r: redis.Redis) -> None:
    _check_send_cooldown(email, user_type, r)
    code = _store_code(email, user_type, r)
    await send_verification_email(email, code)


def verify_and_consume_code(email: str, user_type: str, code: str, r: redis.Redis) -> None:
    key = f"verify_code:{email}:{user_type}"
    stored = r.get(key)
    if not stored or stored != code:
        raise HTTPException(status_code=400, detail="验证码错误或已过期")
    r.delete(key)
