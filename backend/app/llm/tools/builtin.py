import logging
import re
from pathlib import Path
from typing import Any

from app.core.exceptions import ValidationError
from app.schemas.agent.dto import AgentToolCallDTO, AgentToolResultDTO
from app.utils.resume_parser import extract_resume_text

logger = logging.getLogger(__name__)

STATUS_KEYWORD_MAP = {
    "待处理": 1,
    "已查看": 2,
    "查看": 2,
    "面试": 3,
    "拒绝": 4,
    "淘汰": 4,
    "录用": 5,
}


class BuiltinAgentToolRegistry:
    def plan_tools(self, prompt: str, tool_context: dict[str, Any]) -> list[AgentToolCallDTO]:
        calls: list[AgentToolCallDTO] = []
        normalized_prompt = prompt.lower()
        business = tool_context.get("business") or {}
        if any(keyword in prompt for keyword in ("岗位", "职位", "招聘")) or "job" in normalized_prompt:
            calls.append(
                AgentToolCallDTO(
                    tool_name="list_employee_jobs",
                    display_name="读取员工岗位快照",
                    input_payload={"limit": len(business.get("jobs") or [])},
                )
            )
        if any(keyword in prompt for keyword in ("投递", "候选人", "申请", "简历")) or "application" in normalized_prompt:
            calls.append(
                AgentToolCallDTO(
                    tool_name="list_recent_applications",
                    display_name="读取近期投递快照",
                    input_payload={"limit": len(business.get("applications") or [])},
                )
            )
        if any(keyword in prompt for keyword in ("评估", "分数", "匹配", "报告")) or "evaluation" in normalized_prompt:
            calls.append(
                AgentToolCallDTO(
                    tool_name="summarize_evaluations",
                    display_name="汇总评估结果快照",
                    input_payload={"limit": len(business.get("evaluations") or [])},
                )
            )
        if any(keyword in prompt for keyword in ("更新状态", "标记", "录用", "拒绝", "面试", "待处理")):
            calls.append(
                AgentToolCallDTO(
                    tool_name="prepare_application_status_action",
                    display_name="生成投递状态变更待确认动作",
                    input_payload=self._parse_application_status_action(prompt),
                )
            )
        if any(keyword in prompt for keyword in ("上下文", "记忆", "缓存", "提示词", "Trace", "trace")):
            calls.append(
                AgentToolCallDTO(
                    tool_name="inspect_context_window",
                    display_name="检查会话上下文窗口",
                    input_payload={
                        "prompt_prefix_hash": tool_context.get("prompt_prefix_hash"),
                        "recent_message_count": len(tool_context.get("recent_messages") or []),
                    },
                )
            )
        if any(keyword in normalized_prompt for keyword in ("trace", "run", "运行", "执行", "耗时")):
            calls.append(
                AgentToolCallDTO(
                    tool_name="summarize_trace",
                    display_name="汇总会话执行轨迹",
                    input_payload={
                        "run_count": len(tool_context.get("runs") or []),
                    },
                )
            )
        return calls[:4]

    def execute(self, call: AgentToolCallDTO, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        logger.info("Agent内置只读工具开始执行：tool_name=%s", call.tool_name)
        handlers = {
            "inspect_context_window": lambda: self._inspect_context_window(tool_context),
            "summarize_trace": lambda: self._summarize_trace(tool_context),
            "list_employee_jobs": lambda: self._list_employee_jobs(tool_context),
            "list_recent_applications": lambda: self._list_recent_applications(tool_context),
            "summarize_evaluations": lambda: self._summarize_evaluations(tool_context),
            "prepare_application_status_action": lambda: self._prepare_application_status_action(call, tool_context),
            "parse_resume_file": lambda: self._parse_resume_file(call, tool_context),
        }
        handler = handlers.get(call.tool_name)
        result = handler() if handler else self._build_missing_tool_result(call)
        logger.info("Agent内置只读工具执行完成：tool_name=%s success=%s", call.tool_name, result.success)
        return result

    def _parse_application_status_action(self, prompt: str) -> dict[str, Any]:
        application_id = None
        match = re.search(r"(?:投递|申请|application)[^\d]{0,10}(\d+)", prompt, flags=re.IGNORECASE)
        if not match:
            match = re.search(r"\b(\d+)\b", prompt)
        if match:
            application_id = int(match.group(1))
        target_status = None
        for keyword, status in STATUS_KEYWORD_MAP.items():
            if keyword in prompt:
                target_status = status
                break
        return {"application_id": application_id, "target_status": target_status}

    def _build_missing_tool_result(self, call: AgentToolCallDTO) -> AgentToolResultDTO:
        return AgentToolResultDTO(
            tool_name=call.tool_name,
            display_name=call.display_name,
            success=False,
            error_message="工具不存在或未启用",
        )

    def _inspect_context_window(self, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        recent_messages = tool_context.get("recent_messages") or []
        memories = tool_context.get("memories") or []
        return AgentToolResultDTO(
            tool_name="inspect_context_window",
            display_name="检查会话上下文窗口",
            output_payload={
                "prompt_prefix_hash": tool_context.get("prompt_prefix_hash"),
                "snapshot_id": tool_context.get("snapshot_id"),
                "recent_message_count": len(recent_messages),
                "memory_count": len(memories),
                "recent_message_roles": [message.get("role") for message in recent_messages if isinstance(message, dict)],
            },
        )

    def _summarize_trace(self, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        runs = tool_context.get("runs") or []
        success_count = len([run for run in runs if isinstance(run, dict) and run.get("status") == 2])
        failed_count = len([run for run in runs if isinstance(run, dict) and run.get("status") == 3])
        return AgentToolResultDTO(
            tool_name="summarize_trace",
            display_name="汇总会话执行轨迹",
            output_payload={
                "run_count": len(runs),
                "success_count": success_count,
                "failed_count": failed_count,
                "latest_run": runs[0] if runs else None,
            },
        )

    def _list_employee_jobs(self, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        jobs = self._business_items(tool_context, "jobs")
        return AgentToolResultDTO(
            tool_name="list_employee_jobs",
            display_name="读取员工岗位快照",
            output_payload={"jobs": jobs, "total": len(jobs)},
        )

    def _list_recent_applications(self, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        applications = self._business_items(tool_context, "applications")
        return AgentToolResultDTO(
            tool_name="list_recent_applications",
            display_name="读取近期投递快照",
            output_payload={"applications": applications, "total": len(applications)},
        )

    def _summarize_evaluations(self, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        evaluations = self._business_items(tool_context, "evaluations")
        evaluated = [item for item in evaluations if item.get("final_score") is not None]
        avg_score = round(sum(float(item.get("final_score") or 0) for item in evaluated) / len(evaluated), 2) if evaluated else 0
        return AgentToolResultDTO(
            tool_name="summarize_evaluations",
            display_name="汇总评估结果快照",
            output_payload={"evaluations": evaluations, "evaluated_count": len(evaluated), "avg_score": avg_score},
        )

    def _prepare_application_status_action(self, call: AgentToolCallDTO, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        applications = self._business_items(tool_context, "applications")
        application_id = call.input_payload.get("application_id")
        target_status = call.input_payload.get("target_status")
        matched_application = next((item for item in applications if item.get("id") == application_id), None)
        if not application_id or target_status is None:
            return AgentToolResultDTO(
                tool_name="prepare_application_status_action",
                display_name="生成投递状态变更待确认动作",
                success=False,
                error_message="缺少投递ID或目标状态，无法生成待确认动作",
            )
        if not matched_application:
            return AgentToolResultDTO(
                tool_name="prepare_application_status_action",
                display_name="生成投递状态变更待确认动作",
                success=False,
                error_message="未在当前可见投递快照中找到该投递",
            )
        return AgentToolResultDTO(
            tool_name="prepare_application_status_action",
            display_name="生成投递状态变更待确认动作",
            output_payload={
                "action_required": {
                    "capability_key": "application.update_status",
                    "action_name": "更新投递状态",
                    "target_type": "application",
                    "target_id": application_id,
                    "input_payload": {"application_id": application_id, "status": target_status},
                    "preview_payload": {
                        "application": matched_application,
                        "target_status": target_status,
                    },
                }
            },
        )

    def _parse_resume_file(self, call: AgentToolCallDTO, tool_context: dict[str, Any]) -> AgentToolResultDTO:
        """
        从 PDF/DOCX 简历文件抽取纯文本（编排 resume_extract 节点显式调用）。

        input_payload 或 tool_context.resume_attachment 需提供 resume_id、file_path。
        """
        attachment = tool_context.get("resume_attachment") or {}
        resume_id = call.input_payload.get("resume_id") or attachment.get("resume_id")
        file_path = attachment.get("file_path") or call.input_payload.get("file_path")
        file_name = attachment.get("file_name") or call.input_payload.get("file_name") or ""

        if not file_path:
            return AgentToolResultDTO(
                tool_name="parse_resume_file",
                display_name=call.display_name,
                success=False,
                error_message="缺少简历文件路径，无法解析",
            )

        full_path = Path(file_path)
        if not full_path.is_absolute():
            from app.utils.storage.registry import StorageRegistry

            full_path = Path(StorageRegistry.get().get_full_path(str(file_path)))

        if not full_path.exists():
            return AgentToolResultDTO(
                tool_name="parse_resume_file",
                display_name=call.display_name,
                success=False,
                error_message="简历文件不存在",
            )

        try:
            raw_text = extract_resume_text(full_path).strip()
        except ValidationError as exc:
            logger.warning("parse_resume_file 失败：resume_id=%s path=%s err=%s", resume_id, full_path, exc.message)
            return AgentToolResultDTO(
                tool_name="parse_resume_file",
                display_name=call.display_name,
                success=False,
                error_message=exc.message,
            )

        if not raw_text:
            return AgentToolResultDTO(
                tool_name="parse_resume_file",
                display_name=call.display_name,
                success=False,
                error_message="简历文件未解析到文本内容",
            )

        logger.info(
            "parse_resume_file 成功：resume_id=%s file=%s length=%s",
            resume_id,
            file_name or full_path.name,
            len(raw_text),
        )
        return AgentToolResultDTO(
            tool_name="parse_resume_file",
            display_name=call.display_name,
            output_payload={
                "resume_id": resume_id,
                "file_name": file_name or full_path.name,
                "raw_text": raw_text,
                "text_length": len(raw_text),
            },
        )

    def _business_items(self, tool_context: dict[str, Any], key: str) -> list[dict[str, Any]]:
        business = tool_context.get("business") or {}
        return business.get(key) or []


builtin_agent_tools = BuiltinAgentToolRegistry()
