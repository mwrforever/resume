import logging
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import List
from app.services.eval_service import EvalService
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user

router = APIRouter()

logger = logging.getLogger(__name__)


class BatchEvalRequest(BaseModel):
    resume_ids: List[int]
    job_id: int


def get_service(db=Depends(get_db)) -> EvalService:
    return EvalService(
        EvalRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.post("/batch")
async def batch_evaluate(
    req: BatchEvalRequest,
    background_tasks: BackgroundTasks,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """
    批量触发评估（员工端核心功能）

    提交评估任务到后台处理
    """
    # TODO: 实际提交到Celery任务队列
    # background_tasks.add_task(run_evaluation_task, req.resume_ids, req.job_id)

    logger.info(f"员工 {current_user['sub']} 提交批量评估: {len(req.resume_ids)} 份简历, 岗位 {req.job_id}")

    return {"code": 200, "message": "评估任务已提交", "data": {"count": len(req.resume_ids)}}


@router.get("/{match_id}")
async def get_evaluation(
    match_id: int,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """获取评估详情"""
    result = await service.get_evaluation_detail(match_id)
    return {"code": 200, "message": "success", "data": result}


@router.get("/{match_id}/skill-hits")
async def get_skill_hits(
    match_id: int,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """获取技能命中详情"""
    result = await service.get_evaluation_detail(match_id)
    return {"code": 200, "message": "success", "data": result["skill_hits"]}