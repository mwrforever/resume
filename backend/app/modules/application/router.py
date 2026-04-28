from app.api.v1.employee.applications import router as employee_router

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, get_db
from app.modules.application.repository import ApplicationRepository
from app.modules.application.service import ApplicationService
from app.modules.eval_template.repository import EvalTemplateRepository
from app.modules.eval_template.service import EvalTemplateService
from app.modules.job.repository import JobRepository
from app.modules.resume.repository import ResumeRepository
from app.schemas.application import ApplyRequest
from app.schemas.response import ApiResponse, ApplicationDetail, PageData

user_router = APIRouter()


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db),
        EvalTemplateService(EvalTemplateRepository(db)),
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


__all__ = ["employee_router", "user_router"]
