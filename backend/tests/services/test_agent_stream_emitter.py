"""AgentStreamEmitter 9 个 emit_* 方法的单调 seq 与信封字段校验。"""

from app.llm.streaming.emitter import AgentStreamEmitter


def _new(emitter_kwargs: dict | None = None) -> AgentStreamEmitter:
    return AgentStreamEmitter(
        session_id=42, run_id="run_x", workflow_type="interview_questions",
        **(emitter_kwargs or {}),
    )


def test_run_start_envelope_shape():
    e = _new()
    env = e.emit_run_start(enable_thinking=True, user_message_id=99)
    assert env.v == 1
    assert env.type == "run.start"
    assert env.seq == 1
    assert env.data["run_id"] == "run_x"
    assert env.data["enable_thinking"] is True
    assert env.data["user_message_id"] == 99
    assert env.data["resume"] is False  # 默认非续接


def test_run_start_resume_flag():
    """emit_run_start 带 resume=True 时，data.resume 为 True（续接模式）。"""
    e = _new()
    env = e.emit_run_start(enable_thinking=False, user_message_id=None, resume=True)
    assert env.data["resume"] is True


def test_seq_is_monotonic_across_emits():
    e = _new()
    seqs = [
        e.emit_run_start(enable_thinking=False, user_message_id=1).seq,
        e.emit_step(step_id="x", title="t", status="running").seq,
        e.emit_block_start(index=0, block={"type": "text", "text": ""}).seq,
        e.emit_block_delta(index=0, delta={"text_delta": "hi"}).seq,
        e.emit_block_stop(index=0).seq,
        e.emit_run_finish(agent_message_id=1).seq,
    ]
    assert seqs == [1, 2, 3, 4, 5, 6]


def test_interaction_request_payload():
    e = _new()
    env = e.emit_interaction_request(
        request_id="req_x", interaction_type="job_selection",
        title="选岗位", prompt="从候选中选",
        schema={"type": "object"}, data={"candidates": [1, 2]},
    )
    assert env.type == "interaction.request"
    assert env.data["request_id"] == "req_x"
    assert env.data["interaction_type"] == "job_selection"
    assert env.data["data"]["candidates"] == [1, 2]


def test_interaction_resolve_carries_values():
    e = _new()
    env = e.emit_interaction_resolve(request_id="req_x", values={"job_full_name": "高级算法工程师"})
    assert env.type == "interaction.resolve"
    assert env.data["values"]["job_full_name"] == "高级算法工程师"


def test_run_error_default_retriable_false():
    e = _new()
    env = e.emit_run_error(code="job_validation_exhausted", message="超过 3 次")
    assert env.data["retriable"] is False


def test_next_block_index_is_monotonic():
    """emitter 内置 block index 分配器，单调递增。"""
    e = _new()
    assert e.next_block_index() == 0
    assert e.next_block_index() == 1
    assert e.next_block_index() == 2


def test_block_index_independent_from_seq():
    """seq 与 block index 是两个独立计数器。"""
    e = _new()
    e.emit_run_start(enable_thinking=False, user_message_id=1)
    idx0 = e.next_block_index()
    e.emit_block_start(index=idx0, block={"type": "text", "text": ""})
    e.emit_block_stop(index=idx0)
    assert idx0 == 0  # 第一次 next_block_index 应为 0


def test_emit_run_finish_with_next_task_id():
    """emit_run_finish 可携带 next_task_id。"""
    e = _new()
    env = e.emit_run_finish(agent_message_id=5, next_task_id="task-2")
    assert env.type == "run.finish"
    assert env.data["agent_message_id"] == 5
    assert env.data["next_task_id"] == "task-2"


def test_emit_run_finish_without_next_task_id():
    """不传 next_task_id 时为 None。"""
    e = _new()
    env = e.emit_run_finish(agent_message_id=5)
    assert env.data["next_task_id"] is None


def test_block_index_starts_from_index_start():
    """emitter 的 block index 应从 index_start 开始（跨 run 全局递增）。"""
    e = AgentStreamEmitter(
        session_id=1, run_id="r1", workflow_type="interview_questions",
        index_start=10,
    )
    assert e.next_block_index() == 10
    assert e.next_block_index() == 11
    assert e.next_block_index() == 12


def test_max_block_index_used_tracks_allocations():
    """max_block_index_used 反映本 run 分配到的最大 index（run.finish 延时落库用）。"""
    e = AgentStreamEmitter(
        session_id=1, run_id="r1", workflow_type="interview_questions",
        index_start=20,
    )
    # 未分配时为 index_start - 1
    assert e.max_block_index_used == 19
    e.next_block_index()  # 20
    e.next_block_index()  # 21
    e.next_block_index()  # 22
    assert e.max_block_index_used == 22
