import json
import logging

import redis.asyncio as redis
from redis.asyncio import Redis

from app.infrastructure.config import get_settings

logger = logging.getLogger(__name__)

_redis_client: Redis | None = None


def get_redis_client() -> Redis:
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_DB,
            password=settings.redis_password or None,
            decode_responses=True,
        )
    return _redis_client


LUA_SEND_COOL = """
local key = KEYS[1]
local exists = redis.call('EXISTS', key)
if exists == 1 then
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

LUA_IP_COUNT = """
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then
    redis.call('EXPIRE', key, 60)
end
if count > limit then
    return 0
end
return 1
"""


class CacheService:
    _send_cool_sha: str | None = None
    _verify_code_sha: str | None = None
    _ip_count_sha: str | None = None

    def __init__(self, client: Redis):
        self.client = client

    async def _ensure_scripts(self) -> None:
        if self._send_cool_sha is None:
            self._send_cool_sha = await self.client.script_load(LUA_SEND_COOL)
        if self._verify_code_sha is None:
            self._verify_code_sha = await self.client.script_load(LUA_VERIFY_CODE)
        if self._ip_count_sha is None:
            self._ip_count_sha = await self.client.script_load(LUA_IP_COUNT)

    async def get(self, key: str) -> str | None:
        return await self.client.get(key)

    async def set(self, key: str, value: str, expire: int) -> None:
        await self.client.setex(key, expire, value)

    async def delete(self, key: str) -> None:
        await self.client.delete(key)

    async def get_json(self, key: str) -> dict | None:
        val = await self.client.get(key)
        if not val:
            return None
        return json.loads(val)

    async def set_json(self, key: str, value: dict, expire: int) -> None:
        await self.client.setex(key, expire, json.dumps(value, default=str))

    async def delete_pattern(self, pattern: str) -> None:
        cursor = 0
        while True:
            cursor, keys = await self.client.scan(cursor, match=pattern)
            if keys:
                await self.client.delete(*keys)
            if cursor == 0:
                break

    # ── verification scripts ────────────────────────────────────────────────

    async def check_send_cooldown(self, user_type: str, identifier: str) -> bool:
        await self._ensure_scripts()
        key = f"verify:send:{user_type}:{identifier}"
        result = await self.client.evalsha(self._send_cool_sha, 1, key)
        return result == 1

    async def store_code(self, user_type: str, identifier: str, code: str) -> None:
        key = f"verify:code:{user_type}:{identifier}"
        await self.client.setex(key, 300, code)

    async def verify_code(self, user_type: str, identifier: str, code: str) -> int:
        await self._ensure_scripts()
        key = f"verify:code:{user_type}:{identifier}"
        result = await self.client.evalsha(self._verify_code_sha, 1, key, code)
        return result

    async def check_ip_count(self, ip: str, limit: int = 5) -> bool:
        await self._ensure_scripts()
        key = f"verify:count:{ip}"
        result = await self.client.evalsha(self._ip_count_sha, 1, key, limit)
        return result == 1


async def get_cache() -> CacheService:
    return CacheService(get_redis_client())
