from typing import List
from fastapi import APIRouter, Depends, Query
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.repositories.eval_repo import EvalRepository
from app.repositories.eval_template_repo import EvalTemplateRepository
from app.services.eval_template_service import EvalTemplateService
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse, EmployeeApplicationItem, PageData

router = APIRouter()

STATUS_NAMES = {
    0: "待评估",
    1: "待处理",
    2: "已查看",
    3: "面试中",
    4: "已拒绝",
    5: "已录用",
    6: "已结束",
}


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db),
        EvalTemplateService(EvalTemplateRepository(db)),
    )


@router.get("", response_model=ApiResponse[PageData])
async def list_applications(
    job_id: int = Query(None),
    job_ids: List[int] = Query(None),
    status: int = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db)
):
    """获取投递列表（员工端）"""
    skip = (page - 1) * page_size
    filter_job_ids = job_ids or ([job_id] if job_id else None)
    apps = await service.app_repo.get_all(skip, page_size, status, filter_job_ids)
    total = await service.app_repo.get_all_count(status, filter_job_ids)

    resume_file_names = await service.resume_repo.get_file_names_batch([a.resume_id for a in apps])
    eval_repo = EvalRepository(db)
    match_map = await eval_repo.get_matches_by_application_ids([a.id for a in apps])

    items = [
        EmployeeApplicationItem(
            id=a.id,
            user_id=a.user_id,
            job_id=a.job_id,
            job_name=(a.job_snapshot or {}).get("job", {}).get("name", ""),
            job_snapshot=a.job_snapshot,
            resume_id=a.resume_id,
            resume_file_name=resume_file_names.get(a.resume_id),
            match_id=match_map.get(a.id),
            status=a.status,
            status_name=STATUS_NAMES.get(a.status, "未知"),
            create_time=a.create_time,
        )
        for a in apps
    ]

    return ApiResponse(
        data=PageData(total=total, items=items)
    )


@router.put("/{app_id}/status", response_model=ApiResponse)
async def update_application_status(
    app_id: int,
    status: int,
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """更新投递状态"""
    await service.update_status(app_id, status)
    return ApiResponse(code=200, message="更新成功")
