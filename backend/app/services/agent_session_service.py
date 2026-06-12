"""
AgentSessionService：会话生命周期与消息查询。

职责：
- 会话 CRUD（创建 / 列表 / 详情 / 重命名 / 软删除）
- enable_thinking 开关持久化
- 会话标题异步生成入口（fire-and-forget）

不做：SSE 编排、graph 运行、Redis stream buffer、消息落库（属于 AgentRuntimeService）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from app.core.exceptions import ForbiddenError, NotFoundError
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.repositories.agent_repository import AgentRepository
from app.schemas.agent.request import (
    AgentSessionCreate,
    AgentSessionModelSelect,
    AgentSessionUpdate,
)
from app.schemas.agent.response import (
    AgentMessageItem,
    AgentSessionDetail,
    AgentSessionItem,
)

logger = logging.getLogger(__name__)


class AgentSessionService:
    """会话 CRUD + thinking 持久化。"""

    def __init__(
        self, agent_repo: AgentRepository, model_router: LLMModelRouter | None = None,
    ) -> None:
        self._repo = agent_repo
        self._router = model_router or get_default_model_router()

    async def create_session(
        self, body: AgentSessionCreate, current_user: dict,
    ) -> AgentSessionItem:
        """创建新会话。

        Args:
            body: 创建请求体（title + selected_model_name）
            current_user: JWT 解码后的用户信息（含 user_type 和 sub）

        Returns:
            创建后的会话列表项
        """
        employee_id = self._employee_id(current_user)
        session = await self._repo.create_session(
            session_key=uuid.uuid4().hex,
            employee_id=employee_id,
            title=body.title,
            selected_model_name=body.selected_model_name,
        )
        await self._repo.commit()
        return AgentSessionItem.model_validate(session)

    async def list_sessions(
        self, *, page: int, page_size: int, current_user: dict, keyword: str | None = None,
    ) -> dict:
        """分页查询员工会话列表。

        Args:
            page: 页码（从 1 开始）
            page_size: 每页数量
            current_user: JWT 用户信息
            keyword: 搜索关键词（可选）

        Returns:
            {total: int, items: [AgentSessionItem]}
        """
        employee_id = self._employee_id(current_user)
        skip = (page - 1) * page_size
        total = await self._repo.count_sessions(employee_id, keyword)
        items = await self._repo.list_sessions(employee_id, skip, page_size, keyword)
        return {"total": total, "items": [AgentSessionItem.model_validate(it) for it in items]}

    async def get_session_detail(
        self, *, session_id: int, current_user: dict,
    ) -> AgentSessionDetail:
        """获取会话详情（含消息列表）。

        Raises:
            NotFoundError: 会话不存在
        """
        session = await self._require_session(session_id, current_user)
        messages = await self._repo.list_messages(session.id)
        return AgentSessionDetail(
            session=AgentSessionItem.model_validate(session),
            messages=[AgentMessageItem.model_validate(m) for m in messages],
        )

    async def update_session(
        self, *, session_id: int, body: AgentSessionUpdate, current_user: dict,
    ) -> AgentSessionItem:
        """更新会话（重命名）。

        Args:
            session_id: 会话 ID
            body: 更新请求体
            current_user: JWT 用户信息

        Returns:
            更新后的会话列表项
        """
        session = await self._require_session(session_id, current_user)
        updated = await self._repo.update_session(session.id, title=body.title)
        if not updated:
            raise NotFoundError("会话不存在")
        await self._repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def select_model(
        self, *, session_id: int, body: AgentSessionModelSelect, current_user: dict,
    ) -> AgentSessionItem:
        """切换会话使用的模型。

        Args:
            body: 包含 model_name 的请求体
        """
        session = await self._require_session(session_id, current_user)
        updated = await self._repo.update_session(session.id, selected_model_name=body.model_name)
        if not updated:
            raise NotFoundError("会话不存在")
        await self._repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def set_enable_thinking(
        self, *, session_id: int, enable_thinking: bool, current_user: dict,
    ) -> AgentSessionItem:
        """持久化 thinking 开关。

        Args:
            enable_thinking: 是否启用思考模式
        """
        session = await self._require_session(session_id, current_user)
        # enable_thinking 在数据库中存储为 int（0/1）
        updated = await self._repo.update_session(
            session.id, enable_thinking=1 if enable_thinking else 0,
        )
        await self._repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def delete_session(self, *, session_id: int, current_user: dict) -> None:
        """软删除会话（status 置 0）。"""
        session = await self._require_session(session_id, current_user)
        await self._repo.soft_delete_session(session.id)
        await self._repo.commit()

    def schedule_title_generation(
        self, *, session_id: int, user_content: str, runtime_config,
    ) -> None:
        """异步触发标题生成，调用方 fire-and-forget。"""
        asyncio.create_task(self._generate_title(session_id, user_content, runtime_config))

    # ---------- 内部 ----------

    async def _generate_title(
        self, session_id: int, user_content: str, runtime_config,
    ) -> None:
        """根据首条用户消息自动生成会话标题。"""
        try:
            snippet = user_content.strip().replace("\n", " ")[:200]
            prompt = "请为以下对话生成简短标题（不超过 20 字，无引号、无换行，仅标题）：\n" + snippet
            result = await self._router.complete(prompt, runtime_config)
            title = result.content.strip().replace('"', "").replace("'", "")[:50]
            if title:
                await self._repo.update_session(session_id, title=title)
                await self._repo.commit()
                logger.info("会话标题已生成：session_id=%s title=%s", session_id, title)
        except Exception:
            logger.warning("会话标题生成失败：session_id=%s", session_id, exc_info=True)

    async def _require_session(self, session_id: int, current_user: dict):
        """校验会话归属并返回，不存在则抛 NotFoundError。"""
        employee_id = self._employee_id(current_user)
        session = await self._repo.get_session(session_id, employee_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    @staticmethod
    def _employee_id(current_user: dict) -> int:
        """从 JWT payload 提取员工 ID。

        Raises:
            ForbiddenError: 非员工账号
        """
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])
