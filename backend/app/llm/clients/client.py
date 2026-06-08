"""LLM 同步客户端桥接层。

提供两种模式：
- 同步模式（Celery / 单测）：在独立事件循环中运行异步路由
- 异步模式（Agent 运行时）：直接调用异步路由，避免事件循环冲突
"""

import asyncio
import logging
from typing import Coroutine, TypeVar

from app.core.config import get_settings
from app.llm.model_router import get_default_model_router
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

logger = logging.getLogger(__name__)

settings = get_settings()
T = TypeVar("T")


def _run_async_completion(coro: Coroutine[object, object, T]) -> T:
    """在独立事件循环中运行异步协程（仅限非事件循环环境使用）。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("同步LLM客户端不能在事件循环中直接调用，请使用 async_llm_complete")


async def async_llm_complete(prompt: str, model: str | None = None, max_retries: int = 3, timeout: int = 60) -> str:
    """异步 LLM 调用入口，用于 Agent 运行时异步上下文。"""
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
    result = await get_default_model_router().complete(prompt, runtime_config)
    return result.content


async def async_llm_complete_with_result(prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
    """异步 LLM 调用（含完整结果），用于 Agent 运行时异步上下文。"""
    return await get_default_model_router().complete(prompt, runtime_config)


def llm_complete(prompt: str, model: str | None = None, max_retries: int = 3, timeout: int = 60) -> str:
    """同步 LLM 调用入口，仅在 Celery worker / 非事件循环环境中使用。"""
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
    """同步 LLM 调用（含完整结果），仅在 Celery worker / 非事件循环环境中使用。"""
    return _run_async_completion(get_default_model_router().complete(prompt, runtime_config))