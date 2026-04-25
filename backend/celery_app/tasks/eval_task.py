from __future__ import annotations

import asyncio
import logging
from functools import lru_cache

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.repositories.eval_repo import EvalRepository
from app.repositories.job_repo import JobRepository
from app.repositories.resume_repo import ResumeRepository
from app.services.eval_service import EvalService
from celery_app.celery import celery_app

logger = logging.getLogger(__name__)


# 使用 lru_cache 确保整个 Celery Worker 进程只创建一个 Engine（复用连接池）
@lru_cache(maxsize=1)
def get_async_engine():
    from app.core.config import get_settings
    settings = get_settings()
    return create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)

# 2. 修改返回类型为 async_sessionmaker[AsyncSession]
def get_async_session_factory() -> async_sessionmaker[AsyncSession]:
    """获取异步数据库会话工厂"""
    # 3. 使用 async_sessionmaker，不需要传 class_ 参数，它默认就是 AsyncSession
    return async_sessionmaker(get_async_engine(), expire_on_commit=False)


async def _async_eval_logic(resume_ids: list[int], job_id: int) -> dict:
    """
    真正的异步业务逻辑封装
    """
    logger.info(f"开始评估 {len(resume_ids)} 份简历，岗位 {job_id}")

    session_factory = get_async_session_factory()

    # 使用 async with 确保会话在使用后正确关闭
    async with session_factory() as session:
        try:
            eval_repo = EvalRepository(session)
            resume_repo = ResumeRepository(session)
            job_repo = JobRepository(session)
            service = EvalService(eval_repo, resume_repo, job_repo)

            results: list[dict] = []
            for resume_id in resume_ids:
                try:
                    result = await service.evaluate_resume(resume_id, job_id)
                    results.append({
                        "resume_id": resume_id,
                        "status": "success",
                        "match_id": result.get("match_id")
                    })
                except Exception as e:
                    # 单个简历失败仅记录错误，不影响其他简历的评估（不抛出异常）
                    logger.error(f"简历 {resume_id} 评估失败: {e}")
                    results.append({
                        "resume_id": resume_id,
                        "status": "failed",
                        "error": str(e)
                    })

            return {"status": "completed", "count": len(resume_ids), "results": results}

        except Exception as e:
            # 只有在发生全局性错误（如数据库断开）时才抛出，交由外层重试
            logger.error(f"批量评估任务发生严重错误: {e}")
            raise


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_evaluation_task(self, resume_ids: list[int], job_id: int) -> dict:
    """
    Celery 异步评估任务 (同步入口)

    Args:
        self: Celery task 实例 (bind=True)
        resume_ids: 要评估的简历ID列表
        job_id: 目标岗位ID

    Returns:
        包含任务执行结果的字典
    """
    try:
        # 在同步的 Celery 任务中，使用 asyncio.run() 来驱动异步代码
        return asyncio.run(_async_eval_logic(resume_ids, job_id))
    except Exception as exc:
        logger.error(f"批量评估任务失败，准备重试: {exc}")
        # 只有在遇到严重错误时才触发 Celery 重试机制
        raise self.retry(exc=exc)
