from celery_app.celery import celery_app
from app.services.eval_service import EvalService
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import logging

logger = logging.getLogger(__name__)


def get_sync_session():
    """获取同步数据库会话（Celery 任务中使用）"""
    from app.core.config import get_settings
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_evaluation_task(self, resume_ids: list, job_id: int):
    """
    异步评估任务

    Args:
        resume_ids: 要评估的简历ID列表
        job_id: 目标岗位ID
    """
    logger.info(f"开始评估 {len(resume_ids)} 份简历，岗位 {job_id}")

    Session = get_sync_session()
    session = Session()

    try:
        eval_repo = EvalRepository(session)
        resume_repo = ResumeRepository(session)
        job_repo = JobRepository(session)
        service = EvalService(eval_repo, resume_repo, job_repo)

        results = []
        for resume_id in resume_ids:
            try:
                result = service.evaluate_resume(resume_id, job_id)
                results.append({"resume_id": resume_id, "status": "success", "match_id": result["match_id"]})
            except Exception as e:
                logger.error(f"简历 {resume_id} 评估失败: {e}")
                results.append({"resume_id": resume_id, "status": "failed", "error": str(e)})
                raise self.retry(exc=e)

        return {"status": "completed", "count": len(resume_ids), "results": results}

    except Exception as e:
        logger.error(f"批量评估任务失败: {e}")
        raise self.retry(exc=e)
    finally:
        session.close()