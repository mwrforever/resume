"""Agent 流式协议信封 v1 单测：字段约束与未知字段静默接受。"""

from app.schemas.agent.stream.envelope import AgentStreamEnvelope, STREAM_PROTOCOL_VERSION


def test_envelope_minimum_fields():
    """构造最小合法信封，验证必填字段与默认值。"""
    env = AgentStreamEnvelope(
        seq=1, ts=1717920000123, run_id="run_x", session_id=42,
        type="run.start", data={"workflow_type": "interview_questions"},
    )
    assert env.v == 1
    assert env.seq == 1
    assert env.type == "run.start"


def test_envelope_protocol_version_is_one():
    """协议版本常量固定为 1。"""
    assert STREAM_PROTOCOL_VERSION == 1


def test_envelope_silently_accepts_unknown_data_keys():
    """data 内未知键允许，前后端独立演进。"""
    env = AgentStreamEnvelope(
        seq=2, ts=0, run_id="r", session_id=1,
        type="block.delta", data={"index": 0, "delta": {"text_delta": "hi"}, "future_field": True},
    )
    assert env.data["future_field"] is True


def test_envelope_round_trip_json():
    """序列化-反序列化往返一致。"""
    env = AgentStreamEnvelope(seq=3, ts=10, run_id="r", session_id=1, type="run.finish", data={"agent_message_id": 99})
    dumped = env.model_dump(mode="json")
    restored = AgentStreamEnvelope.model_validate(dumped)
    assert restored == env
