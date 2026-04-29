import logging
import re
import time

from langchain_openai import ChatOpenAI

from app.infrastructure.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _normalize_model_name(model: str) -> str:
    return model.removeprefix("openai/")


def _create_llm(model: str, timeout: int) -> ChatOpenAI:
    return ChatOpenAI(
        model=_normalize_model_name(model),
        api_key=settings.openai_api_key,
        base_url=settings.OPENAI_API_BASE,
        timeout=timeout,
        extra_body={"enable_thinking": False},
    )


def llm_complete(prompt: str, model: str | None = None, max_retries: int = 3, timeout: int = 60) -> str:
    """
    Unified LLM completion entry backed by langchain-openai.

    Args:
        prompt: User prompt text.
        model: Optional model override. Defaults to settings.OPENAI_MODEL.
        max_retries: Maximum retry count before trying fallback model.
        timeout: Per-request timeout in seconds.

    Returns:
        Text content returned by the LLM.
    """
    target_model = model or settings.OPENAI_MODEL
    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            response = _create_llm(target_model, timeout).invoke(prompt)
            raw = response.content
            if isinstance(raw, str):
                return _strip_thinking(raw)
            return _strip_thinking(str(raw or ""))
        except Exception as exc:
            last_error = exc
            logger.warning("LLM call failed (attempt %s/%s): %s", attempt + 1, max_retries, exc)
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    if model != settings.FALLBACK_MODEL and target_model != settings.FALLBACK_MODEL:
        logger.info("Trying fallback LLM model %s", settings.FALLBACK_MODEL)
        return llm_complete(prompt, model=settings.FALLBACK_MODEL, max_retries=max_retries, timeout=timeout)

    logger.error("LLM call failed after all retries: %s", last_error)
    raise last_error or RuntimeError("LLM call failed")
