"""gateway 思考参数注入单测。"""

from pydantic import SecretStr

from app.llm.gateway import OpenAICompatibleGateway
from app.schemas.agent.dto import LLMRuntimeConfigDTO


def _config(provider: str, enable_thinking: bool, budget: int | None = None) -> LLMRuntimeConfigDTO:
    """构造测试用 LLMRuntimeConfigDTO，仅关注 provider/思考相关字段。"""
    return LLMRuntimeConfigDTO(
        model_name="qwen-plus",
        api_key=SecretStr("sk-test"),
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        timeout_seconds=30,
        temperature=0.7,
        provider=provider,  # type: ignore[arg-type]
        enable_thinking=enable_thinking,
        thinking_budget_tokens=budget,
    )


def test_qwen_thinking_injects_enable_thinking_and_stream_options():
    """Qwen 开启思考：extra_body 含 enable_thinking + stream_options。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("qwen", True))
    eb = kw["extra_body"]
    assert eb["enable_thinking"] is True
    assert eb["stream_options"] == {"include_usage": True}


def test_qwen_thinking_budget_renamed_to_thinking_budget():
    """thinking_budget_tokens 在注入时改名为 thinking_budget（仅 qwen/other）。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("qwen", True, budget=2048))
    assert kw["extra_body"]["thinking_budget"] == 2048
    assert "thinking_budget_tokens" not in kw["extra_body"]


def test_deepseek_thinking_injects_no_provider_key():
    """DeepSeek 默认出 reasoning，不注入任何 provider 思考 key（但仍带 stream_options）。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("deepseek", True))
    eb = kw["extra_body"]
    assert "enable_thinking" not in eb
    assert "thinking" not in eb
    assert eb["stream_options"] == {"include_usage": True}


def test_thinking_disabled_qwen_explicitly_off():
    """关闭思考时，qwen/other 显式下发 enable_thinking=False。

    DashScope OpenAI 兼容模式下，Qwen3 系列服务端默认按思考模式响应，
    会让正文进入 reasoning_content 字段、content 为空。必须显式关闭。
    """
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("qwen", False))
    assert kw["extra_body"] == {"enable_thinking": False}


def test_thinking_disabled_deepseek_no_extra_body():
    """关闭思考时，DeepSeek 不需要 enable_thinking 开关，extra_body 应缺省。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("deepseek", False))
    assert "extra_body" not in kw
