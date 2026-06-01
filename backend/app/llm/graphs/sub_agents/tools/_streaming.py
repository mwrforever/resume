"""
工具内部下发 v2 协议自定义事件的工具函数。

LangGraph `astream(stream_mode="custom")` 会把工具内通过
`get_stream_writer()(...)` 写入的对象按原样推到外层；外层 runner 再按 v2
协议封装 envelope。这里统一约定写入格式：

    {
        "kind": "data_card" | "evaluation_report" | "tool_started" | "tool_finished",
        "payload": <BaseModel.model_dump(mode="json") | dict>,
    }
"""

from __future__ import annotations

from typing import Any

from langgraph.config import get_stream_writer


def emit_custom(kind: str, payload: dict[str, Any]) -> None:
    """向 LangGraph 自定义流写入一条事件供外层 runner 翻译。"""
    writer = get_stream_writer()
    writer({"kind": kind, "payload": payload})
