"""
ChatModel 适配层。

`langgraph_supervisor.create_supervisor` 与 `langgraph.prebuilt.create_react_agent`
都要求传入实现 `BaseChatModel` 的对象。我们用 LangChain 内置的 `ChatOpenAI` 直接构造，
并通过 LangChain Runnable 的 `with_fallbacks` 拼接 fallback 模型，避免自写 router。
"""

from __future__ import annotations

import logging

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.core.config import get_settings
from app.schemas.agent.dto import LLMRuntimeConfigDTO

logger = logging.getLogger(__name__)
settings = get_settings()


def _normalize_model_name(model_name: str) -> str:
    """剥离 provider 前缀，使 ChatOpenAI 能识别裸模型名。"""
    return model_name.removeprefix("openai/")


def _chat_kwargs(runtime_config: LLMRuntimeConfigDTO) -> dict:
    """把 LLMRuntimeConfigDTO 映射为 ChatOpenAI 构造参数。"""
    extra_body = dict(runtime_config.extra_body or {})
    extra_body["enable_thinking"] = runtime_config.enable_thinking
    extra_body["enable_prompt_cache"] = runtime_config.enable_prompt_cache
    return {
        "model": _normalize_model_name(runtime_config.model_name),
        "api_key": runtime_config.api_key or settings.openai_api_key,
        "base_url": runtime_config.base_url or settings.OPENAI_API_BASE,
        "timeout": runtime_config.timeout_seconds,
        "temperature": runtime_config.temperature,
        "top_p": runtime_config.top_p,
        "max_tokens": runtime_config.max_tokens,
        "presence_penalty": runtime_config.presence_penalty,
        "frequency_penalty": runtime_config.frequency_penalty,
        "max_retries": runtime_config.max_retries,
        "extra_body": extra_body,
    }


def build_chat_model(runtime_config: LLMRuntimeConfigDTO) -> BaseChatModel:
    """
    依据运行时配置构造一个 BaseChatModel。

    - 主模型：ChatOpenAI(**_chat_kwargs(runtime_config))
    - 若运行时配置了 fallback_model_name 且与主模型不同，使用 LangChain 内置
      `with_fallbacks([fallback_model])` 包装，保持 Runnable 接口不变。
    """
    primary = ChatOpenAI(**_chat_kwargs(runtime_config))
    fallback_name = runtime_config.fallback_model_name
    if fallback_name and fallback_name != runtime_config.model_name:
        fallback_config = runtime_config.model_copy(
            update={"model_name": fallback_name, "fallback_model_name": None}
        )
        fallback = ChatOpenAI(**_chat_kwargs(fallback_config))
        logger.info(
            "ChatModel 启用 fallback：primary=%s fallback=%s",
            runtime_config.model_name,
            fallback_name,
        )
        return primary.with_fallbacks([fallback])
    return primary
