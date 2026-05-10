import asyncio
import logging

from app.core.config import get_settings
from app.llm.gateway import LLMGatewayError, OpenAICompatibleGateway
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

logger = logging.getLogger(__name__)
settings = get_settings()


class LLMModelRouter:
    def __init__(self, gateways: list[OpenAICompatibleGateway] | None = None):
        registered_gateways = gateways or [OpenAICompatibleGateway()]
        self.gateways = {gateway.protocol: gateway for gateway in registered_gateways}

    async def complete(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
        return await self._complete_with_route(prompt, runtime_config)

    async def _complete_with_route(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
        gateway = self.gateways.get(runtime_config.protocol)
        if not gateway:
            raise LLMGatewayError("模型协议暂不支持")
        last_error: LLMGatewayError | None = None
        for attempt in range(runtime_config.max_retries + 1):
            try:
                return await gateway.complete_once(prompt, runtime_config)
            except LLMGatewayError as exc:
                last_error = exc
                logger.warning("LLM route failed (attempt %s/%s): %s", attempt + 1, runtime_config.max_retries + 1, exc)
                if attempt < runtime_config.max_retries:
                    await asyncio.sleep(2 ** attempt)
        if runtime_config.fallback_model_name and runtime_config.model_name != runtime_config.fallback_model_name:
            fallback_config = runtime_config.model_copy(update={"model_name": runtime_config.fallback_model_name, "fallback_model_name": None})
            return await self._complete_with_route(prompt, fallback_config)
        raise LLMGatewayError(str(last_error) if last_error else "模型调用失败")


DEFAULT_MODEL_ROUTER = LLMModelRouter()


def get_default_model_router() -> LLMModelRouter:
    return DEFAULT_MODEL_ROUTER
