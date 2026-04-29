import logging
from typing import Optional

from fastapi import Header, HTTPException

from app.utils.security import decode_token

logger = logging.getLogger(__name__)


async def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization:
        logger.debug("No authorization header")
        raise HTTPException(status_code=401, detail="Missing authorization")
    if not authorization.startswith("Bearer "):
        logger.debug("Invalid auth format: %s", authorization[:50])
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    try:
        payload = decode_token(token)
        logger.debug("Token decoded, type=%s, sub=%s", payload.get("type"), payload.get("sub"))
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except ValueError:
        logger.error("Token decode error")
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_current_user_optional(authorization: str = Header(None)) -> Optional[dict]:
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
