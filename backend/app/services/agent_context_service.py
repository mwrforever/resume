import hashlib
from decimal import Decimal
from typing import Any

from app.llm.prompts.manager import prompt_manager
from app.models.agent_message import AgentMessage
from app.repositories.agent_memory_repository import AgentMemoryRepository
from app.schemas.agent.response import AgentContextSnapshotItem, AgentMemoryItem, AgentMessageItem, AgentSessionWindowItem
from app.services.cache_service import CacheService
from app.utils.cache_utils import AGENT_PROMPT_PREFIX_KEY, AGENT_PROMPT_PREFIX_TTL

SNAPSHOT_MESSAGE_THRESHOLD = 8
RECENT_MESSAGE_LIMIT = 6
MEMORY_LIMIT = 8


class AgentContextService:
    def __init__(self, memory_repo: AgentMemoryRepository, cache: CacheService | None = None):
        self.memory_repo = memory_repo
        self.cache = cache

    async def list_memories(self, employee_id: int, touch_access_time: bool = False) -> list[AgentMemoryItem]:
        memories = await self.memory_repo.list_memories(employee_id, MEMORY_LIMIT, touch_access_time)
        return [AgentMemoryItem.model_validate(memory) for memory in memories]

    async def list_snapshots(self, session_id: int) -> list[AgentContextSnapshotItem]:
        snapshots = await self.memory_repo.list_snapshots(session_id)
        return [AgentContextSnapshotItem.model_validate(snapshot) for snapshot in snapshots]

    async def build_session_window(
        self,
        session_id: int,
        messages: list[AgentMessage],
        employee_id: int,
        exclude_message_id: int | None = None,
        touch_access_time: bool = False,
    ) -> AgentSessionWindowItem:
        latest_snapshot = await self.memory_repo.latest_snapshot(session_id)
        window_messages = [message for message in messages if message.id != exclude_message_id]
        recent_messages = window_messages[-RECENT_MESSAGE_LIMIT:]
        memories = await self.memory_repo.list_memories(employee_id, MEMORY_LIMIT, touch_access_time)
        prompt_prefix_hash = self._prompt_prefix_hash(latest_snapshot.summary_text if latest_snapshot else "", [memory.content for memory in memories])
        window = AgentSessionWindowItem(
            snapshot=AgentContextSnapshotItem.model_validate(latest_snapshot) if latest_snapshot else None,
            recent_messages=[AgentMessageItem.model_validate(message) for message in recent_messages],
            token_count=sum(message.token_count or 0 for message in recent_messages),
            prompt_prefix_hash=prompt_prefix_hash,
        )
        return window

    async def maybe_create_snapshot(
        self,
        session_id: int,
        messages: list[AgentMessage],
        model_name: str | None,
    ) -> AgentContextSnapshotItem | None:
        latest_snapshot = await self.memory_repo.latest_snapshot(session_id)
        covered_end_id = latest_snapshot.covered_message_end_id if latest_snapshot else 0
        uncovered_messages = [message for message in messages if message.id > covered_end_id]
        if len(uncovered_messages) < SNAPSHOT_MESSAGE_THRESHOLD:
            return None
        snapshot_messages = uncovered_messages[:-RECENT_MESSAGE_LIMIT] or uncovered_messages
        if not snapshot_messages:
            return None
        summary_text = self._summarize_messages(snapshot_messages)
        snapshot = await self.memory_repo.create_snapshot(
            session_id=session_id,
            snapshot_version=await self.memory_repo.next_snapshot_version(session_id),
            summary_text=summary_text,
            covered_message_start_id=snapshot_messages[0].id,
            covered_message_end_id=snapshot_messages[-1].id,
            message_count=len(snapshot_messages),
            token_count=sum(message.token_count or 0 for message in snapshot_messages),
            model_name=model_name,
        )
        return AgentContextSnapshotItem.model_validate(snapshot)

    async def upsert_preference_memory(self, employee_id: int, session_id: int, user_content: str) -> AgentMemoryItem | None:
        preference = self._extract_preference(user_content)
        if not preference:
            return None
        memory = await self.memory_repo.upsert_memory(
            employee_id=employee_id,
            memory_type="preference",
            memory_key=preference["key"],
            content=preference["content"],
            importance_score=Decimal("60.00"),
            confidence_score=Decimal("70.00"),
            source_session_id=session_id,
        )
        return AgentMemoryItem.model_validate(memory)

    async def build_prompt(self, user_content: str, session_window: AgentSessionWindowItem | None, memories: list[AgentMemoryItem]) -> str:
        prefix_text = None
        if self.cache and session_window and session_window.prompt_prefix_hash:
            cached_prefix = await self.cache.get_json(AGENT_PROMPT_PREFIX_KEY.format(prefix_hash=session_window.prompt_prefix_hash))
            if isinstance(cached_prefix, dict) and isinstance(cached_prefix.get("prefix_text"), str):
                prefix_text = cached_prefix["prefix_text"]
        if prefix_text is None:
            # 前缀只依赖历史摘要和长期记忆，可按 hash 缓存；当前用户输入始终在运行时模板中追加。
            prefix_text = prompt_manager.render(
                "agent_prompt_prefix",
                system_prompt=prompt_manager.render("agent_system_prompt"),
                snapshot_summary=session_window.snapshot.summary_text if session_window and session_window.snapshot else "",
                memories=[memory.content for memory in memories[:MEMORY_LIMIT]],
            )
            if self.cache and session_window and session_window.prompt_prefix_hash:
                await self.cache.set_json(
                    AGENT_PROMPT_PREFIX_KEY.format(prefix_hash=session_window.prompt_prefix_hash),
                    {"prefix_text": prefix_text},
                    AGENT_PROMPT_PREFIX_TTL,
                )
        recent_messages = []
        if session_window and session_window.recent_messages:
            # 最近消息不进入前缀缓存，确保每次请求都使用最新会话窗口。
            for message in session_window.recent_messages:
                recent_messages.append({"role": message.role, "text": self._message_text(message.content)})
        return prompt_manager.render(
            "agent_runtime_prompt",
            prefix_text=prefix_text,
            recent_messages=recent_messages,
            user_content=user_content,
        )

    def build_replay_payload(
        self,
        raw_content: str,
        context_refs: list[dict[str, Any]],
        resolved_prompt: str,
        session_window: AgentSessionWindowItem | None,
        memories: list[AgentMemoryItem],
        user_message_id: int,
    ) -> dict[str, Any]:
        return {
            "message_id": user_message_id,
            "raw_content": raw_content,
            "context_refs": context_refs,
            "resolved_prompt": resolved_prompt,
            "prompt_prefix_hash": session_window.prompt_prefix_hash if session_window else None,
            "snapshot_id": session_window.snapshot.id if session_window and session_window.snapshot else None,
            "memory_ids": [memory.id for memory in memories],
            "recent_message_ids": [message.id for message in session_window.recent_messages] if session_window else [],
        }

    def _summarize_messages(self, messages: list[AgentMessage]) -> str:
        lines = []
        for message in messages:
            text = self._message_text(message.content)
            if text:
                lines.append(f"{message.role}: {text[:300]}")
        return "\n".join(lines)[:4000]

    def _message_text(self, content: dict[str, Any]) -> str:
        blocks = content.get("blocks") if isinstance(content, dict) else None
        if not isinstance(blocks, list):
            return ""
        texts = []
        for block in blocks:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                texts.append(block["text"])
        return "\n".join(texts)

    def _extract_preference(self, user_content: str) -> dict[str, str] | None:
        markers = ("记住", "以后", "偏好", "习惯")
        if not any(marker in user_content for marker in markers):
            return None
        normalized = user_content.strip()[:500]
        memory_key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        return {"key": memory_key, "content": normalized}

    def _prompt_prefix_hash(self, snapshot_text: str, memories: list[str]) -> str:
        payload = "\n".join([snapshot_text, *memories])
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
