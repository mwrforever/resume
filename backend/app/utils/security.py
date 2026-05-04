import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import HTTPException, Header
from jose import JWTError, jwt
from app.core.config import get_settings

settings = get_settings()
MAX_BCRYPT_PASSWORD_BYTES = 72


logger = logging.getLogger(__name__)


def _password_bytes(password: str) -> bytes:
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > MAX_BCRYPT_PASSWORD_BYTES:
        raise ValueError("Password cannot be longer than 72 bytes")
    return password_bytes


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(_password_bytes(plain_password), hashed_password.encode("utf-8"))
    except ValueError:
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        return payload
    except JWTError:
        raise ValueError("Invalid token")


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