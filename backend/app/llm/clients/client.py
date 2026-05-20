import asyncio
from typing import Coroutine, TypeVar

from app.core.config import get_settings
from app.llm.model_router import get_default_model_router
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

settings = get_settings()
T = TypeVar("T")


def _run_async_completion(coro: Coroutine[object, object, T]) -> T:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("同步LLM客户端不能在事件循环中直接调用，请使用asyncio.to_thread或异步模型路由")


def llm_complete(prompt: str, model: str | None = None, max_retries: int = 3, timeout: int = 60) -> str:
    runtime_config = LLMRuntimeConfigDTO(
        model_name=model or settings.OPENAI_MODEL,
        api_key=settings.openai_api_key,
        base_url=settings.OPENAI_API_BASE,
        fallback_model_name=settings.FALLBACK_MODEL,
        extra_body={"enable_thinking": False},
        timeout_seconds=timeout,
        max_retries=max_retries,
        source="env",
    )
    return _run_async_completion(get_default_model_router().complete(prompt, runtime_config)).content


def llm_complete_with_result(prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
    return _run_async_completion(get_default_model_router().complete(prompt, runtime_config))
