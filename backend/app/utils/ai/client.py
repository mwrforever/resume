import litellm
from app.core.config import get_settings
import logging
import time

logger = logging.getLogger(__name__)

settings = get_settings()


def llm_complete(prompt: str, model: str = None, max_retries: int = 3) -> str:
    """
    统一LLM调用入口

    Args:
        prompt: 提示词
        model: 模型名称，默认使用配置中的模型
        max_retries: 最大重试次数

    Returns:
        LLM返回的文本内容

    Raises:
        Exception: 当所有重试都失败时
    """
    target_model = model or settings.OPENAI_MODEL
    last_error = None

    for attempt in range(max_retries):
        try:
            response = litellm.completion(
                model=target_model,
                messages=[{"role": "user", "content": prompt}],
                timeout=30,
            )
            return response.choices[0].message.content
        except Exception as e:
            last_error = e
            logger.warning(f"LLM调用失败 (尝试 {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # 指数退避

    # 所有重试都失败，尝试备用模型
    if model != settings.FALLBACK_MODEL and target_model != settings.FALLBACK_MODEL:
        logger.info(f"尝试使用备用模型 {settings.FALLBACK_MODEL}")
        return llm_complete(prompt, model=settings.FALLBACK_MODEL, max_retries=max_retries)

    logger.error(f"LLM调用最终失败: {last_error}")
    raise last_error