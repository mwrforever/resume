import litellm
from litellm import RetryConfig
from app.core.config import get_settings
import logging

logger = logging.getLogger(__name__)

settings = get_settings()

# 全局重试配置：指数退避，最多3次
retry_config = RetryConfig(
    max_retries=3,
    timeout=30,
    backoff_factor=2,
)


def llm_complete(prompt: str, model: str = None) -> str:
    """
    统一LLM调用入口

    Args:
        prompt: 提示词
        model: 模型名称，默认使用配置中的模型

    Returns:
        LLM返回的文本内容

    Raises:
        Exception: 当所有重试都失败时
    """
    try:
        response = litellm.completion(
            model=model or settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            retry_config=retry_config,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"LLM调用失败: {e}")
        # 降级到备用模型
        if model != settings.FALLBACK_MODEL:
            logger.info(f"尝试使用备用模型 {settings.FALLBACK_MODEL}")
            return llm_complete(prompt, model=settings.FALLBACK_MODEL)
        raise