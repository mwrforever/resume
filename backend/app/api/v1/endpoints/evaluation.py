import logging

from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.deps import get_db
from app.services.cache_service import get_cache, CacheService
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.repositories.application_repository import ApplicationRepository
from app.services.evaluation_service import EvalService
from app.schemas.vo.request.evaluation_request import BatchEvalRequest
from app.schemas.vo.response.evaluation_response import ApiResponse, EvalResult
from app.workers.celery.task.eval_task import run_evaluation_task

router = APIRouter()

logger = logging.getLogger(__name__)

def get_service(db=Depends(get_db), cache: CacheService = Depends(get_cache)) -> EvalService:
    return EvalService(
        EvalRepository(db),
        ResumeRepository(db),
        JobRepository(db),
        ApplicationRepository(db),
        cache,
    )


@router.post("/batch", response_model=ApiResponse)
async def batch_evaluate(
    req: BatchEvalRequest,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """批量触发评估（员工端核心功能）"""
    await service.validate_batch_applications(req.application_ids)
    logger.info(f"员工 {current_user['sub']} 提交批量评估: {len(req.application_ids)} 条投递")
    run_evaluation_task.apply_async(args=(req.application_ids,), ignore_result=True)
    return ApiResponse(code=200, message="评估任务已提交", data={"count": len(req.application_ids)})


@router.get("/{match_id}", response_model=ApiResponse[EvalResult])
async def get_evaluation(
    match_id: int,
    service: EvalService = Depends(get_service),
):
    """获取评估详情"""
    result = await service.get_evaluation_detail(match_id)
    return ApiResponse(data=EvalResult.model_validate(result))


@router.get("/{match_id}/skill-hits", response_model=ApiResponse)
async def get_skill_hits(
    match_id: int,
    service: EvalService = Depends(get_service),
):
    """获取技能命中详情"""
    result = await service.get_evaluation_detail(match_id)
    return ApiResponse(data=result["skill_hits"])