"""ApplicationAgent tools for listing applications and proposing actions."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Annotated, Any

from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import InjectedState
from langgraph.types import interrupt

from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.sub_agents.tools._streaming import emit_custom

logger = logging.getLogger(__name__)

APPLICATION_STATUS_LABELS: dict[int, str] = {
    1: "\u5f85\u7b5b\u9009",
    2: "\u9762\u8bd5\u4e2d",
    3: "\u5df2\u5f55\u7528",
    4: "\u5df2\u62d2\u7edd",
    5: "\u5df2\u5f52\u6863",
}
APPLICATION_LIST_TITLE = "\u6295\u9012\u67e5\u8be2\u7ed3\u679c"
APPLICATION_LIST_SUMMARY = "\u5171\u627e\u5230 {count} \u6761\u6295\u9012"
ACTION_NAME_UPDATE_STATUS = "\u53d8\u66f4\u6295\u9012\u72b6\u6001"
ERROR_INVALID_STATUS = "\u76ee\u6807\u72b6\u6001\u4e0d\u5408\u6cd5"
ERROR_APPLICATION_OUT_OF_SCOPE = "\u6295\u9012 {application_id} \u4e0d\u5728\u5f53\u524d\u5458\u5de5\u4e1a\u52a1\u8303\u56f4\u5185"


def _application_snapshot(state: AgentRuntimeState) -> list[dict[str, Any]]:
    """Return application rows from injected runtime state."""
    business = (state.get("tool_context") or {}).get("business") or {}
    applications = business.get("applications") or []
    return [item for item in applications if isinstance(item, dict)]


def build_application_tools() -> list[BaseTool]:
    """Build ApplicationAgent LangChain tools."""

    @tool("list_applications")
    def list_applications(
        job_id: int | None,
        status: int | None,
        limit: int,
        state: Annotated[AgentRuntimeState, InjectedState],
    ) -> str:
        """List current employee applications and emit an application-list data card."""
        capped = max(1, min(int(limit or 20), 30))
        filtered: list[dict[str, Any]] = []
        for row in _application_snapshot(state):
            if job_id is not None and row.get("job_id") != job_id:
                continue
            if status is not None and row.get("status") != status:
                continue
            filtered.append(row)
        items = filtered[:capped]
        emit_custom(
            "data_card",
            {
                "card_id": uuid.uuid4().hex,
                "card_type": "application_list",
                "title": APPLICATION_LIST_TITLE,
                "summary": APPLICATION_LIST_SUMMARY.format(count=len(items)),
                "body": {"items": items, "job_id": job_id, "status": status, "limit": capped},
            },
        )
        return json.dumps({"total": len(items), "items": items}, ensure_ascii=False)

    @tool("propose_application_status_update")
    def propose_application_status_update(
        application_id: int,
        target_status: int,
        reason: str,
        state: Annotated[AgentRuntimeState, InjectedState],
    ) -> str:
        """Request a user-confirmed interrupt before changing an application status."""
        if target_status not in APPLICATION_STATUS_LABELS:
            return json.dumps({"error": ERROR_INVALID_STATUS}, ensure_ascii=False)

        applications = _application_snapshot(state)
        target = next((row for row in applications if row.get("id") == application_id), None)
        if not target:
            return json.dumps({"error": ERROR_APPLICATION_OUT_OF_SCOPE.format(application_id=application_id)}, ensure_ascii=False)

        action_id = uuid.uuid4().hex
        decision = interrupt(
            {
                "kind": "action",
                "action_id": action_id,
                "capability_key": "application.update_status",
                "action_name": ACTION_NAME_UPDATE_STATUS,
                "description": reason,
                "target_type": "application",
                "target_id": application_id,
                "input_payload": {"application_id": application_id, "status": target_status},
                "preview_payload": {
                    "application_id": application_id,
                    "user_name": target.get("user_name"),
                    "job_name": target.get("job_name"),
                    "from_status": target.get("status"),
                    "to_status": target_status,
                    "to_status_label": APPLICATION_STATUS_LABELS[target_status],
                    "reason": reason,
                },
            }
        )
        logger.info("Application status action resumed: application_id=%s decision=%s", application_id, decision)
        return json.dumps(decision or {"status": "pending"}, ensure_ascii=False)

    return [list_applications, propose_application_status_update]
