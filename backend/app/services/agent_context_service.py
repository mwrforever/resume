import hashlib
from decimal import Decimal
from typing import Any

from app.llm.prompts.manager import prompt_manager
from app.models.agent_message import AgentMessage
from app.repositories.agent_memory_repository import AgentMemoryRepository
from app.schemas.agent.response import AgentMemoryItem
from app.services.cache_service import CacheService
from app.utils.cache_utils import AGENT_PROMPT_PREFIX_KEY, AGENT_PROMPT_PREFIX_TTL

RECENT_MESSAGE_LIMIT = 6
MEMORY_LIMIT = 8


class AgentContextService:
    """Agent 上下文服务：负责长期记忆管理与 Prompt 组装。

    主要职责：
    - 查询/更新员工级 preference 长期记忆
    - 基于记忆哈希缓存 Prompt 前缀，减少重复渲染开销
    - 组装包含前缀上下文 + 近期对话 + 当前输入的最终 Prompt
    """

    def __init__(self, memory_repo: AgentMemoryRepository, cache: CacheService | None = None):
        self.memory_repo = memory_repo
        self.cache = cache

    async def list_memories(self, employee_id: int, touch_access_time: bool = False) -> list[AgentMemoryItem]:
        """获取员工长期记忆列表（最多 MEMORY_LIMIT 条）。

        Args:
            employee_id: 员工 ID
            touch_access_time: 是否更新访问时间

        Returns:
            list[AgentMemoryItem]: 记忆视图对象列表
        """
        memories = await self.memory_repo.list_memories(employee_id, MEMORY_LIMIT, touch_access_time)
        return [AgentMemoryItem.model_validate(memory) for memory in memories]

    async def upsert_preference_memory(self, employee_id: int, session_id: int, user_content: str) -> AgentMemoryItem | None:
        """从用户输入中提取偏好关键词，并 upsert 到长期记忆库。

        Args:
            employee_id: 员工 ID
            session_id: 当前会话 ID（作为来源）
            user_content: 用户原始输入

        Returns:
            AgentMemoryItem | None: 若未检测到偏好标记则返回 None
        """
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

    async def build_prompt(self, user_content: str, recent_messages: list[AgentMessage], memories: list[AgentMemoryItem]) -> str:
        """根据长期记忆和近期消息组装 Agent 运行时的完整 Prompt。

        先尝试从缓存读取 prompt_prefix，未命中则渲染并写入缓存；
        最后将前缀、近期对话与当前用户输入组合为最终 Prompt。

        Args:
            user_content: 当前用户输入
            recent_messages: 会话中最近消息实体列表
            memories: 长期记忆列表

        Returns:
            str: 渲染后的完整 Prompt 文本
        """
        prefix_text = None
        prompt_prefix_hash = self._prompt_prefix_hash([memory.content for memory in memories])
        if self.cache and prompt_prefix_hash:
            cached_prefix = await self.cache.get_json(AGENT_PROMPT_PREFIX_KEY.format(prefix_hash=prompt_prefix_hash))
            if isinstance(cached_prefix, dict) and isinstance(cached_prefix.get("prefix_text"), str):
                prefix_text = cached_prefix["prefix_text"]
        if prefix_text is None:
            # 前缀只依赖长期记忆，可按 hash 缓存；当前用户输入始终在运行时模板中追加。
            # ????? agent/system ????????????
            prefix_text = prompt_manager.render(
                "agent/system",
                snapshot_summary="",
                memories=[memory.content for memory in memories[:MEMORY_LIMIT]],
                recent_messages=[],
                user_content="",
            )
            if self.cache and prompt_prefix_hash:
                await self.cache.set_json(
                    AGENT_PROMPT_PREFIX_KEY.format(prefix_hash=prompt_prefix_hash),
                    {"prefix_text": prefix_text},
                    AGENT_PROMPT_PREFIX_TTL,
                )
        recent_message_payload = [
            {"role": message.role, "text": self._message_text(message.content)}
            for message in recent_messages[-RECENT_MESSAGE_LIMIT:]
        ]
        # ? prefix_text ????????????? Prompt
        return prompt_manager.render(
            "agent/system",
            snapshot_summary="",
            memories=[memory.content for memory in memories[:MEMORY_LIMIT]],
            recent_messages=recent_message_payload,
            user_content=user_content,
        )

    def build_replay_payload(
        self,
        raw_content: str,
        context_refs: list[dict[str, Any]],
        resolved_prompt: str,
        recent_messages: list[AgentMessage],
        memories: list[AgentMemoryItem],
        user_message_id: int,
    ) -> dict[str, Any]:
        """构造可重放的运行输入载荷，用于后续溯源与调试。

        Args:
            raw_content: 用户原始输入内容
            context_refs: 上下文引用列表
            resolved_prompt: 已解析的 Prompt 文本
            recent_messages: 近期消息实体列表
            memories: 当前使用的长期记忆列表
            user_message_id: 触发本次运行的用户消息 ID

        Returns:
            dict[str, Any]: 包含关键上下文的 replay payload
        """
        return {
            "message_id": user_message_id,
            "raw_content": raw_content,
            "context_refs": context_refs,
            "resolved_prompt": resolved_prompt,
            "memory_ids": [memory.id for memory in memories],
            "recent_message_ids": [message.id for message in recent_messages[-RECENT_MESSAGE_LIMIT:]],
        }

    def _message_text(self, content: dict[str, Any]) -> str:
        """从消息内容的 blocks 结构中提取纯文本。

        Args:
            content: 消息内容字典，内部可能包含 blocks 列表

        Returns:
            str: 拼接后的文本，若结构异常则返回空串
        """
        blocks = content.get("blocks") if isinstance(content, dict) else None
        if not isinstance(blocks, list):
            return ""
        return "\n".join(
            block["text"] for block in blocks
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )

    def _extract_preference(self, user_content: str) -> dict[str, str] | None:
        """识别用户输入中的偏好标记，提取并截断为标准化记忆内容。

        当输入包含"记住/以后/偏好/习惯"等关键词时视为偏好表达。

        Args:
            user_content: 用户原始输入

        Returns:
            dict[str, str] | None: 包含 key 与 content 的字典，未命中则返回 None
        """
        markers = ("记住", "以后", "偏好", "习惯")
        if not any(marker in user_content for marker in markers):
            return None
        normalized = user_content.strip()[:500]
        memory_key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        return {"key": memory_key, "content": normalized}

    def _prompt_prefix_hash(self, memories: list[str]) -> str:
        """基于长期记忆内容生成 prompt 前缀缓存哈希。

        Args:
            memories: 长期记忆文本列表

        Returns:
            str: SHA-256 哈希前 64 位字符串
        """
        payload = "\n".join(memories)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
