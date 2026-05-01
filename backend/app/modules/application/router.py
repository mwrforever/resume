from typing import List

from fastapi import APIRouter, Depends, Query

from app.infrastructure.client.deps import get_current_user
from app.infrastructure.client import get_db
from app.infrastructure.cache import get_cache, CacheService
from app.modules.application.repository import ApplicationRepository
from app.modules.application.service import ApplicationService
from app.modules.eval_template.repository import EvalTemplateRepository
from app.modules.eval_template.service import EvalTemplateService
from app.modules.evaluation.repository import EvalRepository
from app.modules.job.repository import JobRepository
from app.modules.resume.repository import ResumeRepository
from app.schemas.vo.request.application_request import ApplyRequest
from app.schemas.vo.response.application_response import ApiResponse, ApplicationDetail, EmployeeApplicationItem, PageData

employee_router = APIRouter()
user_router = APIRouter()


def get_service(db=Depends(get_db), cache: CacheService = Depends(get_cache)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db),
        EvalTemplateService(EvalTemplateRepository(db)),
        cache,
    )


def get_user_id(current_user: dict = Depends(get_current_user)) -> int:
    return int(current_user["sub"])


@user_router.post("", response_model=ApiResponse)
async def apply_job(
    req: ApplyRequest,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """投递岗位（必须关联附件简历）"""
    app = await service.create_application(user_id, req.job_id, req.resume_id)
    return ApiResponse(code=200, message="投递成功", data={"id": app.id})


@user_router.get("", response_model=ApiResponse[PageData])
async def list_my_applications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """获取我的投递列表"""
    skip = (page - 1) * page_size
    apps, total = await service.get_user_applications(user_id, skip, page_size)
    items = []
    for application in apps:
        snapshot = application.job_snapshot or {}
        job_snapshot = snapshot.get("job", {})
        items.append({
            "id": application.id,
            "job_id": application.job_id,
            "job_name": job_snapshot.get("name"),
            "job_snapshot": snapshot,
            "resume_id": application.resume_id,
            "status": application.status,
            "status_name": service.get_status_name(application.status),
            "create_time": application.create_time
        })
    return ApiResponse(
        data=PageData(
            total=total,
            items=items
        )
    )


@user_router.delete("/{app_id}", response_model=ApiResponse)
async def withdraw_application(
    app_id: int,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """撤回投递"""
    await service.withdraw_application(app_id, user_id)
    return ApiResponse(code=200, message="撤回成功")


@user_router.get("/{app_id}", response_model=ApiResponse[ApplicationDetail])
async def get_my_application(
    app_id: int,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """获取我的投递详情"""
    application = await service.get_application_by_id(app_id, user_id)
    resume = await service.get_resume_by_id(application.resume_id)
    detail = {
        "id": application.id,
        "job_id": application.job_id,
        "job_name": (application.job_snapshot or {}).get("job", {}).get("name"),
        "job_snapshot": application.job_snapshot,
        "resume_id": application.resume_id,
        "status": application.status,
        "status_name": service.get_status_name(application.status),
        "create_time": application.create_time,
        "resume_name": resume.file_name if resume else None,
        "resume_file_path": resume.file_path if resume else None
    }
    return ApiResponse(data=detail)


@employee_router.get("", response_model=ApiResponse[PageData])
async def list_applications(
    job_id: int = Query(None),
    job_ids: List[int] = Query(None),
    dept_ids: List[int] = Query(None),
    status: int = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db)
):
    """获取投递列表（员工端）"""
    skip = (page - 1) * page_size
    filter_job_ids = job_ids or ([job_id] if job_id else None)
    app_rows = await service.app_repo.get_all(skip, page_size, status, filter_job_ids, dept_ids, search)
    total = await service.app_repo.get_all_count(status, filter_job_ids, dept_ids, search)

    resume_file_names = await service.resume_repo.get_file_names_batch([row[0].resume_id for row in app_rows])
    eval_repo = EvalRepository(db)
    match_map = await eval_repo.get_matches_by_application_ids([row[0].id for row in app_rows])

    items = [
        EmployeeApplicationItem(
            id=app.id,
            user_id=app.user_id,
            user_real_name=user_name,
            job_id=app.job_id,
            job_name=(app.job_snapshot or {}).get("job", {}).get("name", ""),
            job_snapshot=app.job_snapshot,
            resume_id=app.resume_id,
            resume_file_name=resume_file_names.get(app.resume_id),
            match_id=match_map.get(app.id),
            status=app.status,
            status_name=service.get_status_name(app.status),
            create_time=app.create_time,
        )
        for app, user_name in app_rows
    ]

    return ApiResponse(
        data=PageData(total=total, items=items)
    )


@employee_router.put("/{app_id}/status", response_model=ApiResponse)
async def update_application_status(
    app_id: int,
    status: int,
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """更新投递状态"""
    await service.update_status(app_id, status)
    return ApiResponse(code=200, message="更新成功")


__all__ = ["employee_router", "user_router"]
