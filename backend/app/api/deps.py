from typing import Optional, Any, AsyncGenerator

from fastapi import Header, HTTPException

from app.core.security import decode_token
from app.models import async_session_maker


async def get_db() -> AsyncGenerator[Any, Any]:
    async with async_session_maker() as session:
        yield session


async def get_current_user(authorization: str = Header(None)) -> dict:
    import logging
    logger = logging.getLogger(__name__)
    if not authorization:
        logger.warning("No authorization header")
        raise HTTPException(status_code=401, detail="Missing authorization")
    if not authorization.startswith("Bearer "):
        logger.warning(f"Invalid auth format: {authorization[:50]}")
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    try:
        payload = decode_token(token)
        logger.warning(f"Token decoded, type={payload.get('type')}, sub={payload.get('sub')}")
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except ValueError as e:
        logger.error(f"Token decode error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user_optional(authorization: str = Header(None)) -> Optional[dict]:
    """可选授权：找不到 token 时返回 None 而不是抛异常"""
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return payload
    except ValueError:
        return None


async def get_current_user_type(authorization: str = Header(...)) -> tuple[dict, str]:
    """Returns (payload, user_type)"""
    payload = await get_current_user(authorization)
    user_type = payload.get("type", "")
    # user_type in token is 'user' or 'employee' from the auth service
    return payload, user_type
