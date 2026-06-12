"""
LLM 模型路由：选模型 → 调 gateway → 失败时 fallback / thinking 自愈降级。

不关心思考模式细节（由 gateway 处理）。不支持按节点切换策略（由调用者决定 runtime_config）。
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator

from app.llm.gateway import LLMGatewayError, OpenAICompatibleGateway
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO, LLMStreamChunkDTO

logger = logging.getLogger(__name__)

# 匹配 provider 抛出"不支持思考模式"的常见错误特征
_THINKING_UNSUPPORTED_PATTERNS = (
    re.compile(r"thinking", re.IGNORECASE),
    re.compile(r"reasoning_content", re.IGNORECASE),
    re.compile(r"enable_thinking", re.IGNORECASE),
)


def _is_thinking_unsupported_error(exc: LLMGatewayError) -> bool:
    """判断异常是否因模型不支持 thinking 模式导致。"""
    msg = str(exc)
    return any(p.search(msg) for p in _THINKING_UNSUPPORTED_PATTERNS)


class LLMModelRouter:
    """模型路由器。"""

    def __init__(self, gateways: list[OpenAICompatibleGateway] | None = None) -> None:
        registered = gateways or [OpenAICompatibleGateway()]
        self.gateways: dict[str, OpenAICompatibleGateway] = {gw.protocol: gw for gw in registered}

    async def stream(
        self, prompt: str, runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        """流式调用，按失败策略路由。"""
        async for chunk in self._stream_with_route(prompt, runtime_config, allow_thinking_self_heal=True):
            yield chunk

    async def complete(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
        """非流式调用，带 fallback。"""
        gateway = self._gateway_for(runtime_config)
        try:
            return await gateway.complete_once(prompt, runtime_config)
        except LLMGatewayError as exc:
            if runtime_config.fallback_model_name and runtime_config.fallback_model_name != runtime_config.model_name:
                fallback = runtime_config.model_copy(
                    update={"model_name": runtime_config.fallback_model_name, "fallback_model_name": None}
                )
                return await self.complete(prompt, fallback)
            raise

    # ---------- 内部 ----------

    def _gateway_for(self, runtime_config: LLMRuntimeConfigDTO) -> OpenAICompatibleGateway:
        """根据协议选择 gateway。"""
        gateway = self.gateways.get(runtime_config.protocol)
        if gateway is None:
            raise LLMGatewayError(f"未知协议: {runtime_config.protocol}")
        return gateway

    async def _stream_with_route(
        self,
        prompt: str,
        runtime_config: LLMRuntimeConfigDTO,
        *,
        allow_thinking_self_heal: bool,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        """流式调用主逻辑：主模型 → thinking 自愈 → fallback。"""
        gateway = self._gateway_for(runtime_config)
        try:
            async for chunk in gateway.stream_once(prompt, runtime_config):
                yield chunk
            return
        except LLMGatewayError as exc:
            # 1) thinking 自愈降级
            if allow_thinking_self_heal and runtime_config.enable_thinking and _is_thinking_unsupported_error(exc):
                logger.warning("LLM 模型不支持 thinking 模式，自动降级重试一次：%s", exc)
                degraded = runtime_config.model_copy(update={"enable_thinking": False})
                async for chunk in self._stream_with_route(prompt, degraded, allow_thinking_self_heal=False):
                    yield chunk
                return
            # 2) fallback 模型
            if runtime_config.fallback_model_name and runtime_config.fallback_model_name != runtime_config.model_name:
                logger.warning("LLM 主模型 %s 失败，切换 fallback %s",
                               runtime_config.model_name, runtime_config.fallback_model_name)
                fallback = runtime_config.model_copy(
                    update={"model_name": runtime_config.fallback_model_name, "fallback_model_name": None}
                )
                async for chunk in self._stream_with_route(prompt, fallback, allow_thinking_self_heal=False):
                    yield chunk
                return
            raise


DEFAULT_MODEL_ROUTER = LLMModelRouter()


def get_default_model_router() -> LLMModelRouter:
    """获取全局默认模型路由器单例。"""
    return DEFAULT_MODEL_ROUTER
