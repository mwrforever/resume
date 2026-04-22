from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.services.job_service import JobService
from app.repositories.job_repo import JobRepository
from app.repositories.application_repo import ApplicationRepository
from app.api.deps import get_db, get_current_user_optional
from app.schemas.response import ApiResponse, JobItem, JobDetail, PageData

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


@router.get("", response_model=ApiResponse[PageData])
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: JobService = Depends(get_job_service)
):
    """用户端：浏览岗位列表"""
    skip = (page - 1) * page_size
    jobs, total, skills_map = await service.get_jobs_with_skills(skip=skip, limit=page_size)

    job_items = []
    for job in jobs:
        item = JobItem.model_validate(job)
        item.skills = skills_map.get(job.id, [])
        job_items.append(item)

    return ApiResponse(
        data=PageData(
            total=total,
            items=job_items
        )
    )


@router.get("/{job_id}", response_model=ApiResponse[JobDetail])
async def get_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    db=Depends(get_db),
    current_user: Optional[dict] = Depends(get_current_user_optional)
):
    """用户端：查看岗位详情（可选登录）"""
    job = await service.get_job_by_id(job_id)
    detail = JobDetail.model_validate(job)
    detail.skills = await service.get_job_skills(job_id, limit=100)

    # 仅登录用户可查看投递状态
    if current_user:
        user_id = int(current_user["sub"])
        app_repo = ApplicationRepository(db)
        app = await app_repo.get_by_user_and_job(user_id, job_id)
        detail.applied = app is not None
        if app:
            detail.application_id = app.id

    return ApiResponse(data=detail)
