"""
OpenAI 协议网关（重写版）。

职责：
- 把 LLMRuntimeConfigDTO 翻译成 ChatOpenAI 构造参数（含 thinking 模式 extra_body 注入）
- 流式响应分流：reasoning_content → kind=thinking；content → kind=text
- 统一异常 LLMGatewayError；ChatOpenAI 实例 LRU 缓存复用 HTTP 连接

不做：业务规则、模型路由（由 model_router 负责）、provider SDK 直接调用。

关键设计（thinking 取值路径）：
流式调用走 **原生 openai SDK**（`openai.AsyncOpenAI`），而不是 langchain 的
`ChatOpenAI.astream`。原因是 langchain-openai 1.x 明确不保留第三方 provider 的
`reasoning_content` 字段（如 DashScope/DeepSeek），会在解析 chunk 时丢弃，导致
思考内容永远为空。原生 SDK 直接读 `delta.reasoning_content`，绕过该限制。
非流式 `complete_once`（标题生成等）无需思考内容，仍用 ChatOpenAI 复用连接。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_openai import ChatOpenAI
from openai import AsyncOpenAI, OpenAIError

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
    # 流式路径：原生 AsyncOpenAI 客户端缓存（含 thinking 模式）
    _stream_client_cache: dict[str, AsyncOpenAI] = {}
    # 非流式路径：ChatOpenAI 实例缓存（标题生成等）
    _chat_model_cache: dict[str, ChatOpenAI] = {}
    _cache_max: int = 16

    # ---------- 内部辅助 ----------

    def _get_or_create_chat_model(self, runtime_config: LLMRuntimeConfigDTO) -> ChatOpenAI:
        """获取/缓存 ChatOpenAI 实例，复用 HTTP 连接池（仅非流式 complete_once 用）。"""
        kwargs = self._chat_kwargs(runtime_config)
        cache_key = f"{kwargs['model']}:{kwargs['base_url']}:{kwargs.get('api_key', '')}"
        cached = self._chat_model_cache.get(cache_key)
        if cached is not None:
            return cached
        instance = ChatOpenAI(**kwargs)
        if len(self._chat_model_cache) >= self._cache_max:
            self._chat_model_cache.pop(next(iter(self._chat_model_cache)))
        self._chat_model_cache[cache_key] = instance
        return instance

    def _get_or_create_stream_client(self, runtime_config: LLMRuntimeConfigDTO) -> AsyncOpenAI:
        """获取/缓存原生 AsyncOpenAI 客户端（流式路径专用）。

        流式调用必须走原生 SDK：langchain-openai 1.x 会丢弃 DashScope/DeepSeek 的
        reasoning_content 字段（见模块 docstring）。
        """
        cache_key = f"{runtime_config.base_url}:{runtime_config.api_key.get_secret_value()}"
        cached = self._stream_client_cache.get(cache_key)
        if cached is not None:
            return cached
        client = AsyncOpenAI(
            api_key=runtime_config.api_key.get_secret_value(),
            base_url=runtime_config.base_url,
            timeout=runtime_config.timeout_seconds,
            max_retries=runtime_config.max_retries,
        )
        if len(self._stream_client_cache) >= self._cache_max:
            self._stream_client_cache.pop(next(iter(self._stream_client_cache)))
        self._stream_client_cache[cache_key] = client
        return client

    def _chat_kwargs(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        """构造 ChatOpenAI kwargs（仅非流式 complete_once 使用）。

        enable_thinking=True：注入 provider 思考开关 + stream_options + thinking_budget。
        enable_thinking=False：对 qwen/other 显式下发 enable_thinking=False，
        避免 DashScope 服务端按模型默认走思考模式导致正文为空。
        """
        extra_body: dict[str, Any] = {}
        if runtime_config.enable_thinking:
            extra_body.update(THINKING_PARAM_MAP.get(runtime_config.provider, THINKING_PARAM_MAP["other"]))
            if runtime_config.thinking_budget_tokens and runtime_config.provider in ("qwen", "other"):
                # Qwen 官方字段名为 thinking_budget（非 thinking_budget_tokens）
                extra_body["thinking_budget"] = runtime_config.thinking_budget_tokens
        elif runtime_config.provider in ("qwen", "other"):
            # 维度建议 / 模板生成 / 简历评估等业务路径默认不开思考；显式关闭以兼容
            # DashScope OpenAI 兼容模式（Qwen3 系列服务端默认开启思考会让 content 走 reasoning_content）。
            extra_body["enable_thinking"] = False

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

    def _raw_request_params(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        """构造原生 openai SDK chat.completions.create 参数（流式路径专用）。

        与 _chat_kwargs 同源，但展平为 create() 顶层参数：extra_body 内的
        enable_thinking / stream_options 直接以 extra_body 形式透传给 DashScope，
        reasoning_content 原样返回在 delta 中（不被 langchain 丢弃）。
        """
        params: dict[str, Any] = {
            "model": runtime_config.model_name,
            "messages": [],  # 由 stream_once 注入（支持 string / messages 两种 prompt）
            "temperature": runtime_config.temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if runtime_config.max_tokens is not None:
            params["max_tokens"] = runtime_config.max_tokens
        extra_body: dict[str, Any] = {}
        if runtime_config.enable_thinking:
            extra_body.update(THINKING_PARAM_MAP.get(runtime_config.provider, THINKING_PARAM_MAP["other"]))
            # include_usage 已在顶层 stream_options 给过，extra_body 内避免重复
            extra_body.pop("stream_options", None)
            if runtime_config.thinking_budget_tokens and runtime_config.provider in ("qwen", "other"):
                extra_body["thinking_budget"] = runtime_config.thinking_budget_tokens
        elif runtime_config.provider in ("qwen", "other"):
            # 与 _chat_kwargs 对称：显式 enable_thinking=False，避免 DashScope 走默认思考行为
            extra_body["enable_thinking"] = False
        if extra_body:
            params["extra_body"] = extra_body
        return params

    @staticmethod
    def _extract_reasoning_from_delta(delta: Any) -> str:
        """从原生 openai SDK 的 delta 对象抽取 reasoning_content。

        DashScope（qwen）在 delta.reasoning_content 返回思维链；
        DeepSeek 同名字段；部分实现用 reasoning 字段。getattr 兜底三种命名。
        """
        for attr in ("reasoning_content", "reasoning", "thinking"):
            val = getattr(delta, attr, None)
            if val:
                return val
        return ""

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
        流式调用（原生 openai SDK）。按以下顺序 yield chunk：
            kind=thinking (多次) → kind=text (多次) → kind=usage (0或1) → kind=done (1)

        必须用原生 SDK 而非 ChatOpenAI.astream：langchain-openai 1.x 会丢弃
        DashScope/DeepSeek 的 reasoning_content，导致思考内容永远为空。
        """
        client = self._get_or_create_stream_client(runtime_config)
        params = self._raw_request_params(runtime_config)
        params["messages"] = [{"role": "user", "content": prompt}]
        finish_reason: str | None = None
        try:
            stream = await client.chat.completions.create(**params)
            async for chunk in stream:
                # usage 仅在最后一个 chunk（choices 为空）出现
                usage = getattr(chunk, "usage", None)
                if usage is not None:
                    yield LLMStreamChunkDTO(
                        kind="usage",
                        usage=TokenUsage(
                            input_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
                            output_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
                        ),
                    )
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    continue
                choice = choices[0]
                delta = getattr(choice, "delta", None)
                if delta is not None:
                    # 抽取 reasoning_content（思考过程）
                    reasoning = self._extract_reasoning_from_delta(delta)
                    if reasoning:
                        yield LLMStreamChunkDTO(kind="thinking", text_delta=reasoning)
                    # 抽取正文内容
                    content = getattr(delta, "content", None)
                    if content:
                        yield LLMStreamChunkDTO(kind="text", text_delta=content)
                # 抽取 finish_reason
                fr = getattr(choice, "finish_reason", None)
                if fr:
                    finish_reason = str(fr)
        except OpenAIError as exc:
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
