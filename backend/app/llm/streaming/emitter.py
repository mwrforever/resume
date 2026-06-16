"""
Agent 流式事件发射器。

只做两件事：
1. 内部维护 seq 单调递增计数器
2. 把方法调用包装成 AgentStreamEnvelope 实例（带 v / seq / ts / run_id / session_id / type / data）

业务规则、缓冲、SSE 序列化均不归 emitter。所有 emit_* 方法返回 envelope，调用者
（Service / Runner / Endpoint）决定如何投递（直接 yield、缓冲、forward）。

线程模型：每次 run 一个独立 emitter 实例（per-request scope）。
"""

from __future__ import annotations

import time
from itertools import count
from typing import Any, Literal

from app.schemas.agent.stream import (
    STREAM_PROTOCOL_VERSION,
    AgentStreamEnvelope,
    BlockStartData,
    BlockDeltaData,
    BlockStopData,
    InteractionRequestData,
    InteractionResolveData,
    InteractionType,
    RunErrorData,
    RunFinishData,
    RunStartData,
    StepStatus,
    StepUpdateData,
)


def _now_ms() -> int:
    """获取当前毫秒时间戳。"""
    return int(time.time() * 1000)


class AgentStreamEmitter:
    """9 个 emit_* 方法封装协议事件构造。"""

    def __init__(
        self,
        *,
        session_id: int,
        run_id: str,
        workflow_type: Literal["interview_questions", "resume_evaluation"],
    ) -> None:
        self.session_id = session_id
        self.run_id = run_id
        self.workflow_type = workflow_type
        self._seq = count(1)
        self._block_index = count(0)

    # ---------- 内部 ----------

    def _wrap(self, *, type: str, data: dict[str, Any]) -> AgentStreamEnvelope:
        """包装成统一信封。"""
        return AgentStreamEnvelope(
            v=STREAM_PROTOCOL_VERSION,
            seq=next(self._seq),
            ts=_now_ms(),
            run_id=self.run_id,
            session_id=self.session_id,
            type=type,
            data=data,
        )

    def next_block_index(self) -> int:
        """分配下一个 block index（由 Service 持有，跨 emit_block_start 调用单调递增）。"""
        return next(self._block_index)

    # ---------- run.* ----------

    def emit_run_start(
        self, *, enable_thinking: bool, user_message_id: int | None,
    ) -> AgentStreamEnvelope:
        """发射 run.start 事件。"""
        data = RunStartData(
            run_id=self.run_id, workflow_type=self.workflow_type,
            enable_thinking=enable_thinking, user_message_id=user_message_id,
        ).model_dump(mode="json")
        return self._wrap(type="run.start", data=data)

    def emit_run_finish(
        self, *, agent_message_id: int, next_task_id: str | None = None,
    ) -> AgentStreamEnvelope:
        """发射 run.finish 事件。

        @param next_task_id: 工作流正常 END 时生成的新 task_id，回传前端用于下一轮隔离。
        """
        data = RunFinishData(
            agent_message_id=agent_message_id, next_task_id=next_task_id,
        ).model_dump(mode="json")
        return self._wrap(type="run.finish", data=data)

    def emit_run_error(self, *, code: str, message: str, retriable: bool = False) -> AgentStreamEnvelope:
        """发射 run.error 事件。"""
        data = RunErrorData(code=code, message=message, retriable=retriable).model_dump(mode="json")
        return self._wrap(type="run.error", data=data)

    # ---------- step ----------

    def emit_step(
        self, *, step_id: str, title: str, status: StepStatus, detail: str | None = None,
    ) -> AgentStreamEnvelope:
        """发射 step.update 事件。"""
        data = StepUpdateData(step_id=step_id, title=title, status=status, detail=detail).model_dump(mode="json")
        return self._wrap(type="step.update", data=data)

    # ---------- block ----------

    def emit_block_start(self, *, index: int, block: dict[str, Any]) -> AgentStreamEnvelope:
        """发射 block.start 事件。"""
        data = BlockStartData(index=index, block=block).model_dump(mode="json")
        return self._wrap(type="block.start", data=data)

    def emit_block_delta(self, *, index: int, delta: dict[str, Any]) -> AgentStreamEnvelope:
        """发射 block.delta 事件。"""
        data = BlockDeltaData(index=index, delta=delta).model_dump(mode="json")
        return self._wrap(type="block.delta", data=data)

    def emit_block_stop(self, *, index: int) -> AgentStreamEnvelope:
        """发射 block.stop 事件。"""
        data = BlockStopData(index=index).model_dump(mode="json")
        return self._wrap(type="block.stop", data=data)

    # ---------- interaction ----------

    def emit_interaction_request(
        self, *, request_id: str, interaction_type: InteractionType,
        title: str, prompt: str,
        schema: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> AgentStreamEnvelope:
        """发射 interaction.request 事件。"""
        payload = InteractionRequestData(
            request_id=request_id, interaction_type=interaction_type,
            title=title, prompt=prompt,
            schema=schema or {}, data=data or {},
        ).model_dump(mode="json", by_alias=True)
        return self._wrap(type="interaction.request", data=payload)

    def emit_interaction_resolve(self, *, request_id: str, values: dict[str, Any]) -> AgentStreamEnvelope:
        """发射 interaction.resolve 事件。"""
        payload = InteractionResolveData(request_id=request_id, values=values).model_dump(mode="json")
        return self._wrap(type="interaction.resolve", data=payload)
