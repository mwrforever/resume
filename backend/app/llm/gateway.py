import logging
import re
from collections.abc import AsyncIterator

from langchain_openai import ChatOpenAI
from openai import OpenAIError

from app.core.config import get_settings
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO, LLMStreamChunkDTO

logger = logging.getLogger(__name__)
settings = get_settings()
LLM_GATEWAY_ERRORS = (OpenAIError, TimeoutError, ValueError)


class LLMGatewayError(RuntimeError):
    pass


class OpenAICompatibleGateway:
    """OpenAI 协议网关：封装 ChatOpenAI 调用，负责协议适配与响应归一化。"""

    protocol = "openai"
    _chat_model_cache: dict[str, ChatOpenAI] = {}
    _chat_model_max_cache: int = 16

    def _get_or_create_chat_model(self, runtime_config: LLMRuntimeConfigDTO) -> ChatOpenAI:
        """获取或缓存 ChatOpenAI 实例，复用 HTTP 连接池以减少延迟。"""
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

    async def complete_once(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
        try:
            response = await self._get_or_create_chat_model(runtime_config).ainvoke(prompt)
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        return self._extract_result(response, runtime_config.model_name)

    async def stream_once(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> AsyncIterator[LLMStreamChunkDTO]:
        chunks: list[str] = []
        usage_metadata: dict = {}
        response_metadata: dict = {}
        try:
            async for chunk in self._get_or_create_chat_model(runtime_config).astream(prompt):
                raw_delta = chunk.content
                delta = raw_delta if isinstance(raw_delta, str) else str(raw_delta or "")
                if delta:
                    chunks.append(delta)
                    yield LLMStreamChunkDTO(delta=delta)
                usage_metadata = dict(getattr(chunk, "usage_metadata", None) or usage_metadata)
                response_metadata = dict(getattr(chunk, "response_metadata", None) or response_metadata)
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        content = self._strip_thinking("".join(chunks))
        prompt_tokens = int(usage_metadata.get("input_tokens") or usage_metadata.get("prompt_tokens") or 0)
        completion_tokens = int(usage_metadata.get("output_tokens") or usage_metadata.get("completion_tokens") or 0)
        total_tokens = int(usage_metadata.get("total_tokens") or prompt_tokens + completion_tokens)
        yield LLMStreamChunkDTO(
            result=LLMResultDTO(
                content=content,
                model_name=runtime_config.model_name,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                usage_detail=usage_metadata,
                raw_response_metadata=response_metadata,
            )
        )

    def _normalize_model_name(self, model_name: str) -> str:
        return model_name.removeprefix("openai/")

    def _chat_kwargs(self, runtime_config: LLMRuntimeConfigDTO) -> dict:
        extra_body = dict(runtime_config.extra_body or {})
        extra_body["enable_thinking"] = runtime_config.enable_thinking
        extra_body["enable_prompt_cache"] = runtime_config.enable_prompt_cache
        return {
            "model": self._normalize_model_name(runtime_config.model_name),
            "api_key": runtime_config.api_key or settings.openai_api_key,
            "base_url": runtime_config.base_url or settings.OPENAI_API_BASE,
            "timeout": runtime_config.timeout_seconds,
            "temperature": runtime_config.temperature,
            "top_p": runtime_config.top_p,
            "max_tokens": runtime_config.max_tokens,
            "presence_penalty": runtime_config.presence_penalty,
            "frequency_penalty": runtime_config.frequency_penalty,
            "extra_body": extra_body,
        }

    def _strip_thinking(self, text: str) -> str:
        return re.sub(r"<think.*?</think\s*>", "", text, flags=re.DOTALL).strip()

    def _extract_result(self, response, model_name: str) -> LLMResultDTO:
        raw_content = response.content
        content = self._strip_thinking(raw_content if isinstance(raw_content, str) else str(raw_content or ""))
        usage_metadata = getattr(response, "usage_metadata", None) or {}
        response_metadata = getattr(response, "response_metadata", None) or {}
        prompt_tokens = int(usage_metadata.get("input_tokens") or usage_metadata.get("prompt_tokens") or 0)
        completion_tokens = int(usage_metadata.get("output_tokens") or usage_metadata.get("completion_tokens") or 0)
        total_tokens = int(usage_metadata.get("total_tokens") or prompt_tokens + completion_tokens)
        return LLMResultDTO(
            content=content,
            model_name=model_name,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            usage_detail=dict(usage_metadata),
            raw_response_metadata=dict(response_metadata),
        )