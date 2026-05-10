import re

from langchain_openai import ChatOpenAI
from openai import OpenAIError

from app.core.config import get_settings
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

settings = get_settings()
LLM_GATEWAY_ERRORS = (OpenAIError, TimeoutError, ValueError)


class LLMGatewayError(RuntimeError):
    pass


class OpenAICompatibleGateway:
    protocol = "openai"

    async def complete_once(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
        try:
            response = await ChatOpenAI(
                model=self._normalize_model_name(runtime_config.model_name),
                api_key=runtime_config.api_key or settings.openai_api_key,
                base_url=runtime_config.base_url or settings.OPENAI_API_BASE,
                timeout=runtime_config.timeout_seconds,
                extra_body=runtime_config.extra_body or {"enable_thinking": False},
            ).ainvoke(prompt)
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        return self._extract_result(response, runtime_config.model_name)

    def _normalize_model_name(self, model_name: str) -> str:
        return model_name.removeprefix("openai/")

    def _strip_thinking(self, text: str) -> str:
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

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
