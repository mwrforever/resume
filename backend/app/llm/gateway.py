"""
OpenAI 协议网关（重写版）。

职责：
- 把 LLMRuntimeConfigDTO 翻译成 ChatOpenAI 构造参数（含 thinking 模式 extra_body 注入）
- 流式响应分流：reasoning_content → kind=thinking；content → kind=text
- 统一异常 LLMGatewayError；ChatOpenAI 实例 LRU 缓存复用 HTTP 连接

不做：业务规则、模型路由（由 model_router 负责）、provider SDK 直接调用。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_openai import ChatOpenAI
from openai import OpenAIError

from app.schemas.agent.dto import (
    LLMResultDTO,
    LLMRuntimeConfigDTO,
    LLMStreamChunkDTO,
    TokenUsage,
)

logger = logging.getLogger(__name__)

LLM_GATEWAY_ERRORS = (OpenAIError, TimeoutError, ValueError)


# Provider 适配表：enable_thinking=True 时注入到 ChatOpenAI extra_body 的键值。
# - qwen/other（阿里云 DashScope OpenAI 兼容）：enable_thinking + stream_options
# - deepseek：DeepSeek-R1 默认输出 reasoning_content，不注入 provider 思考 key，
#   仅靠 stream_options 保证 usage 增量回吐。
THINKING_PARAM_MAP: dict[str, dict[str, Any]] = {
    "deepseek": {"stream_options": {"include_usage": True}},
    "qwen":     {"enable_thinking": True, "stream_options": {"include_usage": True}},
    "other":    {"enable_thinking": True, "stream_options": {"include_usage": True}},
}


class LLMGatewayError(RuntimeError):
    """LLM 调用网关层统一异常。"""


class OpenAICompatibleGateway:
    """OpenAI 协议网关。"""

    protocol = "openai_compatible"
    _chat_model_cache: dict[str, ChatOpenAI] = {}
    _chat_model_max_cache: int = 16

    # ---------- 内部辅助 ----------

    def _get_or_create_chat_model(self, runtime_config: LLMRuntimeConfigDTO) -> ChatOpenAI:
        """获取/缓存 ChatOpenAI 实例，复用 HTTP 连接池。"""
        kwargs = self._chat_kwargs(runtime_config)
        cache_key = f"{kwargs['model']}:{kwargs['base_url']}:{kwargs.get('api_key', '')}"
        cached = self._chat_model_cache.get(cache_key)
        if cached is not None:
            return cached
        instance = ChatOpenAI(**kwargs)
        if len(self._chat_model_cache) >= self._chat_model_max_cache:
            self._chat_model_cache.pop(next(iter(self._chat_model_cache)))
        self._chat_model_cache[cache_key] = instance
        return instance

    def _chat_kwargs(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        """构造 ChatOpenAI kwargs。

        仅在 enable_thinking 时注入 extra_body：provider 思考开关 + stream_options
        + thinking_budget（仅 qwen/other，DeepSeek 不支持该字段）。
        """
        extra_body: dict[str, Any] = {}
        if runtime_config.enable_thinking:
            extra_body.update(THINKING_PARAM_MAP.get(runtime_config.provider, THINKING_PARAM_MAP["other"]))
            if runtime_config.thinking_budget_tokens and runtime_config.provider in ("qwen", "other"):
                # Qwen 官方字段名为 thinking_budget（非 thinking_budget_tokens）
                extra_body["thinking_budget"] = runtime_config.thinking_budget_tokens

        kwargs: dict[str, Any] = {
            "model": runtime_config.model_name,
            "api_key": runtime_config.api_key.get_secret_value(),
            "base_url": runtime_config.base_url,
            "timeout": runtime_config.timeout_seconds,
            "temperature": runtime_config.temperature,
        }
        if runtime_config.max_tokens is not None:
            kwargs["max_tokens"] = runtime_config.max_tokens
        if extra_body:
            kwargs["extra_body"] = extra_body
        return kwargs

    @staticmethod
    def _extract_reasoning(chunk: Any) -> str:
        """
        从 ChatOpenAI 流式 chunk 中抽取 reasoning_content。

        两路 fallback：
            1. chunk.additional_kwargs['reasoning_content']  (DeepSeek/Qwen)
            2. chunk.additional_kwargs['thinking']           (部分实现)
        """
        kw = getattr(chunk, "additional_kwargs", None) or {}
        return kw.get("reasoning_content") or kw.get("thinking") or ""

    @staticmethod
    def _extract_usage(chunk: Any) -> TokenUsage | None:
        """从流式 chunk 或最终响应中抽取 token usage。"""
        meta = getattr(chunk, "usage_metadata", None) or {}
        if not meta:
            return None
        return TokenUsage(
            input_tokens=int(meta.get("input_tokens") or meta.get("prompt_tokens") or 0),
            output_tokens=int(meta.get("output_tokens") or meta.get("completion_tokens") or 0),
        )

    # ---------- 对外 API ----------

    async def stream_once(
        self, prompt: str, runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        """
        流式调用。按以下顺序 yield chunk：
            kind=thinking (多次) → kind=text (多次) → kind=usage (0或1) → kind=done (1)
        """
        chat = self._get_or_create_chat_model(runtime_config)
        finish_reason: str | None = None
        try:
            async for chunk in chat.astream(prompt):
                # 抽取 reasoning_content（思考过程）
                reasoning = self._extract_reasoning(chunk)
                if reasoning:
                    yield LLMStreamChunkDTO(kind="thinking", text_delta=reasoning)
                # 抽取正文内容
                raw_content = chunk.content if isinstance(chunk.content, str) else str(chunk.content or "")
                if raw_content:
                    yield LLMStreamChunkDTO(kind="text", text_delta=raw_content)
                # 抽取 usage
                usage = self._extract_usage(chunk)
                if usage is not None:
                    yield LLMStreamChunkDTO(kind="usage", usage=usage)
                # 抽取 finish_reason
                meta = getattr(chunk, "response_metadata", None) or {}
                if meta.get("finish_reason"):
                    finish_reason = str(meta["finish_reason"])
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        yield LLMStreamChunkDTO(kind="done", finish_reason=finish_reason)

    async def complete_once(
        self, prompt: str, runtime_config: LLMRuntimeConfigDTO,
    ) -> LLMResultDTO:
        """非流式调用，仅用于会话标题生成等内部场景。"""
        chat = self._get_or_create_chat_model(runtime_config)
        try:
            response = await chat.ainvoke(prompt)
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        raw = response.content if isinstance(response.content, str) else str(response.content or "")
        usage = self._extract_usage(response) or TokenUsage()
        return LLMResultDTO(content=raw, model_name=runtime_config.model_name, usage=usage)
