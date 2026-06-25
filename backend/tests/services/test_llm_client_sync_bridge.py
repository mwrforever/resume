"""LLM 同步客户端桥接层测试。"""

from pydantic import SecretStr

from app.llm.clients import client
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO


class FakeRouter:
    """模拟 LLMModelRouter。"""

    async def complete(self, prompt, runtime_config):
        return LLMResultDTO(content=f"回复：{prompt}", model_name=runtime_config.model_name)


def test_llm_complete_waits_for_async_router(monkeypatch):
    """llm_complete 应同步调用异步路由并返回内容。"""
    monkeypatch.setattr(client, "get_default_model_router", lambda: FakeRouter())

    result = client.llm_complete("岗位描述")

    assert result == "回复：岗位描述"


def test_llm_complete_with_result_waits_for_async_router(monkeypatch):
    """llm_complete_with_result 应返回完整 LLMResultDTO。"""
    monkeypatch.setattr(client, "get_default_model_router", lambda: FakeRouter())
    runtime_config = LLMRuntimeConfigDTO(
        provider="other",
        model_name="qwen",
        api_key=SecretStr("secret"),
        base_url="https://example.com/v1",
        fallback_model_name=None,
        timeout_seconds=30,
        max_retries=1,
    )

    result = client.llm_complete_with_result("模板建议", runtime_config)

    assert result.content == "回复：模板建议"
