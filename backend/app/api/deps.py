from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import async_session
from app.core.security import decode_token


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


async def get_current_user(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user_type(authorization: str = Header(...)) -> tuple[dict, str]:
    """Returns (payload, user_type)"""
    payload = await get_current_user(authorization)
    user_type = payload.get("type", "")
    # user_type in token is 'user' or 'employee' from the auth service
    return payload, user_type
