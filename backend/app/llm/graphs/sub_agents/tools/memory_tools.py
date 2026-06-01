"""MemoryAgent tools for recording long-term user preferences."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Annotated

from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import InjectedState

from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.sub_agents.tools._streaming import emit_custom
from app.services.agent_context_service import AgentContextService

logger = logging.getLogger(__name__)

ERROR_MEMORY_DISABLED = "\u8bb0\u5fc6\u80fd\u529b\u672a\u542f\u7528"
ERROR_MEMORY_EMPTY = "\u8bb0\u5fc6\u5185\u5bb9\u4e3a\u7a7a"
ERROR_MEMORY_NOT_PREFERENCE = "\u8bb0\u5fc6\u672a\u8bc6\u522b\u4e3a\u504f\u597d/\u4e60\u60ef\uff0c\u672a\u5199\u5165"
MEMORY_RECORDED_TITLE = "\u5df2\u8bb0\u5f55\u957f\u671f\u8bb0\u5fc6"


def build_memory_tools(context_service: AgentContextService | None) -> list[BaseTool]:
    """Build MemoryAgent LangChain tools."""

    @tool("record_preference_memory")
    async def record_preference_memory(
        content: str,
        state: Annotated[AgentRuntimeState, InjectedState],
    ) -> str:
        """Persist a user preference memory through AgentContextService."""
        if not context_service:
            return json.dumps({"error": ERROR_MEMORY_DISABLED}, ensure_ascii=False)
        text = (content or "").strip()
        if not text:
            return json.dumps({"error": ERROR_MEMORY_EMPTY}, ensure_ascii=False)

        memory = await context_service.upsert_preference_memory(
            employee_id=int(state["employee_id"]),
            session_id=int(state["session_id"]),
            user_content=text,
        )
        if memory is None:
            return json.dumps({"error": ERROR_MEMORY_NOT_PREFERENCE}, ensure_ascii=False)

        emit_custom(
            "data_card",
            {
                "card_id": uuid.uuid4().hex,
                "card_type": "memory_recorded",
                "title": MEMORY_RECORDED_TITLE,
                "summary": memory.content[:80],
                "body": {
                    "memory_id": memory.id,
                    "memory_type": memory.memory_type,
                    "content": memory.content,
                    "importance_score": float(memory.importance_score),
                },
            },
        )
        logger.info("MemoryAgent preference recorded: employee_id=%s memory_id=%s", state.get("employee_id"), memory.id)
        return json.dumps({"memory_id": memory.id, "memory_type": memory.memory_type, "content": memory.content}, ensure_ascii=False)

    return [record_preference_memory]
