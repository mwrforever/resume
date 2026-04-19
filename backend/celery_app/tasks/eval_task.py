from celery_app.celery import celery_app
import logging

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_evaluation_task(self, resume_ids: list, job_id: int):
    """
    异步评估任务

    Args:
        resume_ids: 要评估的简历ID列表
        job_id: 目标岗位ID
    """
    try:
        # TODO: 实现实际的评估逻辑
        logger.info(f"开始评估 {len(resume_ids)} 份简历，岗位 {job_id}")

        for resume_id in resume_ids:
            # 调用 EvalService.evaluate_resume()
            pass

        return {"status": "completed", "count": len(resume_ids)}

    except Exception as e:
        logger.error(f"批量评估任务失败: {e}")
        raise self.retry(exc=e)