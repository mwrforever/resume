"""工作流图节点访问业务服务的 ContextVar 通道。

LangGraph 的 State 必须可被 msgpack 序列化才能写入 checkpoint，
但业务服务实例（InterviewQuestionService 等）不是可序列化对象。
因此服务实例不能放在 State 里，改为通过 contextvars 在单次请求生命周期内传递：
  - 调用方（AgentService）在运行图之前 set
  - 节点函数通过 get() 读取
  - 请求结束后自动清理，不污染 checkpoint
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Any, Iterator

# 单次请求级业务服务容器，key 为服务名，value 为服务实例
# 使用真正的 ContextVar 保证协程安全，避免并发请求间互相覆盖
_workflow_service_ctx: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "_workflow_service_ctx", default=None
)


def get_service(key: str) -> Any:
    """从 ContextVar 读取指定业务服务实例（协程安全）。

    Args:
        key: 服务名，如 interview_question_service / resume_evaluation_service

    Returns:
        服务实例，未设置时返回 None
    """
    ctx = _workflow_service_ctx.get()
    if ctx is None:
        return None
    return ctx.get(key)


def get_all() -> dict[str, Any]:
    """读取全部业务服务上下文（供需要多个服务的节点使用）。"""
    return _workflow_service_ctx.get() or {}


@contextmanager
def workflow_service_context(services: dict[str, Any]) -> Iterator[None]:
    """在 with 块内设置业务服务上下文，退出时自动清理。

    Args:
        services: 业务服务字典，如 {"interview_question_service": svc, ...}
    """
    token = _workflow_service_ctx.set(services)
    try:
        yield
    finally:
        # 恢复为之前的值（None 或上一个请求的服务字典）
        _workflow_service_ctx.reset(token)
