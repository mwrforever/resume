"""Agent stream Redis buffer service tests."""

from typing import Any

import pytest

from app.services.agent_stream_buffer_service import AgentStreamBufferService


class _FakeRedis:
    """测试用 Redis 客户端，记录 APPEND/EXPIRE/GET/DELETE 调用。"""

    def __init__(self) -> None:
        """初始化内存数据。"""
        self.values: dict[str, str] = {}
        self.expires: dict[str, int] = {}
        self.fail_append = False

    async def append(self, key: str, value: str) -> int:
        """模拟 Redis APPEND。"""
        if self.fail_append:
            raise RuntimeError("redis append failed")
        self.values[key] = self.values.get(key, "") + value
        return len(self.values[key])

    async def expire(self, key: str, ttl: int) -> bool:
        """模拟 Redis EXPIRE。"""
        self.expires[key] = ttl
        return True

    async def get(self, key: str) -> str | None:
        """模拟 Redis GET。"""
        return self.values.get(key)

    async def delete(self, key: str) -> int:
        """模拟 Redis DELETE。"""
        self.values.pop(key, None)
        return 1


@pytest.mark.asyncio
async def test_append_event_writes_jsonl_and_refreshes_ttl() -> None:
    """每个事件必须以 JSONL 追加，并刷新 30 分钟 TTL。"""
    redis = _FakeRedis()
    service = AgentStreamBufferService(redis_client=redis)

    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 1, "event": "message.delta"})

    key = "agent:stream_buffer:1:run-1"
    assert redis.values[key].endswith("\n")
    assert '"event":"message.delta"' in redis.values[key]
    assert redis.expires[key] == 1800


@pytest.mark.asyncio
async def test_read_events_parses_jsonl() -> None:
    """读取 Redis JSONL 时返回 envelope 列表。"""
    redis = _FakeRedis()
    service = AgentStreamBufferService(redis_client=redis)
    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 1})
    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 2})

    events = await service.read_events(session_id=1, run_id="run-1")

    assert [item["seq"] for item in events] == [1, 2]


@pytest.mark.asyncio
async def test_append_failure_uses_memory_fallback() -> None:
    """Redis 追加失败时退化为内存缓冲。"""
    redis = _FakeRedis()
    redis.fail_append = True
    service = AgentStreamBufferService(redis_client=redis)

    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 1, "event": "error"})
    events = await service.read_events(session_id=1, run_id="run-1")

    assert events == [{"seq": 1, "event": "error"}]