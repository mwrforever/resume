"""
LangGraph Checkpointer 工厂。

协调器 + 子 Agent 使用 `langgraph.types.interrupt()` 实现表单/动作中断，
LangGraph 必须配置 checkpointer 才能保存中断点状态以支持后续 `Command(resume=...)`。

v1 阶段使用进程内 `InMemorySaver`，单进程内多请求共享、跨进程不持久化。
当前 Agent 工作台的会话窗口短，可接受“服务器重启后未确认表单/动作失效”的折中。
后续可替换为 SqliteSaver / PostgresSaver / RedisSaver 而不影响协调器实现。
"""

from __future__ import annotations

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver

# 进程内单例，避免重复构造时丢失会话状态
_DEFAULT_CHECKPOINTER: BaseCheckpointSaver = InMemorySaver()


def get_default_checkpointer() -> BaseCheckpointSaver:
    """返回当前进程共享的默认 checkpointer。"""
    return _DEFAULT_CHECKPOINTER
