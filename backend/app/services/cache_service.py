import json
import logging
from typing import Any, Optional

import redis.asyncio as redis
from redis.asyncio import Redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_redis_client: Optional[Redis] = None

LUA_IP_COUNT = """
local key = KEYS[1]
local limit = tonumber(ARGV[1])
if not limit then return 0 end

local count = redis.call('INCR', key)
if count == 1 then
    redis.call('EXPIRE', key, 60)
end
if count > limit then
    return 0
end
return 1
"""

LUA_SEND_COOL = """
local key = KEYS[1]
if redis.call('EXISTS', key) == 1 then
    return 0
end
redis.call('SETEX', key, 60, '1')
return 1
"""

LUA_VERIFY_CODE = """
local key = KEYS[1]
local code = redis.call('GET', key)
if not code then
    return -1
end
if code == ARGV[1] then
    redis.call('DEL', key)
    return 1
end
return 0
"""


async def init_redis_client() -> Redis | None:
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_DB,
            password=settings.redis_password or None,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        logger.info("Redis client initialized.")
    return _redis_client


async def close_redis_client() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
        logger.info("Redis client closed.")


def get_redis_client() -> Redis:
    if _redis_client is None:
        raise RuntimeError("Redis client is not initialized. Call `init_redis_client()` first.")
    return _redis_client


class CacheService:
    def __init__(self, client: Redis):
        self.client = client
        self._script_send_cool = self.client.register_script(LUA_SEND_COOL)
        self._script_verify_code = self.client.register_script(LUA_VERIFY_CODE)
        self._script_ip_count = self.client.register_script(LUA_IP_COUNT)

    async def get(self, key: str) -> Optional[str]:
        return await self.client.get(key)

    async def set(self, key: str, value: str, expire: int) -> None:
        await self.client.setex(key, expire, value)

    async def delete(self, key: str) -> None:
        await self.client.delete(key)

    async def get_json(self, key: str) -> Optional[Any]:
        val = await self.client.get(key)
        if not val:
            return None
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            logger.warning(f"Failed to decode JSON for key: {key}")
            return None

    async def set_json(self, key: str, value: Any, expire: int) -> None:
        await self.client.setex(key, expire, json.dumps(value, default=str, separators=(',', ':')))

    async def delete_pattern(self, pattern: str) -> None:
        cursor = 0
        while True:
            cursor, keys = await self.client.scan(cursor, match=pattern, count=100)
            if keys:
                await self.client.unlink(*keys)
            if cursor == 0:
                break

    async def check_send_cooldown(self, user_type: str, identifier: str) -> bool:
        key = f"verify:send:{user_type}:{identifier}"
        result = await self._script_send_cool(keys=[key])
        return result == 1

    async def store_code(self, user_type: str, identifier: str, code: str) -> None:
        key = f"verify:code:{user_type}:{identifier}"
        await self.client.setex(key, 300, code)

    async def verify_code(self, user_type: str, identifier: str, code: str) -> int:
        key = f"verify:code:{user_type}:{identifier}"
        result = await self._script_verify_code(keys=[key], args=[code])
        return result

    async def check_ip_count(self, ip: str, limit: int = 5) -> bool:
        key = f"verify:count:{ip}"
        result = await self._script_ip_count(keys=[key], args=[limit])
        return result == 1


_cache_service: CacheService | None = None


def get_cache() -> CacheService:
    global _cache_service
    if _cache_service is None:
        _cache_service = CacheService(get_redis_client())
    return _cache_service
