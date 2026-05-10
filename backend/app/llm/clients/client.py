from app.core.config import get_settings
from app.llm.model_router import get_default_model_router
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

settings = get_settings()


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
    return get_default_model_router().complete(prompt, runtime_config).content


def llm_complete_with_result(prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
    return get_default_model_router().complete(prompt, runtime_config)
