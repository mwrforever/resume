"""JobAgent tools for searching employee job snapshots."""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import InjectedState

from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.sub_agents.tools._streaming import emit_custom

JOB_LIST_TITLE = "\u5c97\u4f4d\u67e5\u8be2\u7ed3\u679c"
JOB_LIST_SUMMARY = "\u5171\u627e\u5230 {count} \u4e2a\u5c97\u4f4d"


def _job_snapshot(state: AgentRuntimeState) -> list[dict[str, Any]]:
    """Return job rows from injected runtime state."""
    business = (state.get("tool_context") or {}).get("business") or {}
    jobs = business.get("jobs") or []
    return [item for item in jobs if isinstance(item, dict)]


def build_job_tools() -> list[BaseTool]:
    """Build JobAgent LangChain tools."""

    @tool("search_jobs")
    def search_jobs(
        keyword: str | None,
        limit: int,
        state: Annotated[AgentRuntimeState, InjectedState],
    ) -> str:
        """Search current employee jobs by keyword and emit a job-list data card."""
        normalized = (keyword or "").strip()
        capped = max(1, min(int(limit or 10), 20))
        jobs = _job_snapshot(state)
        filtered = [job for job in jobs if normalized in (job.get("name") or "")] if normalized else list(jobs)
        items = filtered[:capped]
        emit_custom(
            "data_card",
            {
                "card_id": uuid.uuid4().hex,
                "card_type": "job_list",
                "title": JOB_LIST_TITLE,
                "summary": JOB_LIST_SUMMARY.format(count=len(items)),
                "body": {"items": items, "keyword": normalized, "limit": capped},
            },
        )
        return json.dumps({"total": len(items), "items": items}, ensure_ascii=False)

    return [search_jobs]
