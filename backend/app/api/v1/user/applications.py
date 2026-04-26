from fastapi import APIRouter, Depends, Query
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.repositories.eval_template_repo import EvalTemplateRepository
from app.services.eval_template_service import EvalTemplateService
from app.schemas.application import ApplyRequest
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse, ApplicationItem, ApplicationDetail, PageData

router = APIRouter()


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db),
        EvalTemplateService(EvalTemplateRepository(db)),
    )


def get_user_id(current_user: dict = Depends(get_current_user)) -> int:
    return int(current_user["sub"])


@router.post("", response_model=ApiResponse)
async def apply_job(
    req: ApplyRequest,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """投递岗位（必须关联附件简历）"""
    app = await service.create_application(user_id, req.job_id, req.resume_id)
    return ApiResponse(code=200, message="投递成功", data={"id": app.id})


@router.get("", response_model=ApiResponse[PageData])
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
    for a in apps:
        snapshot = a.job_snapshot or {}
        job_snapshot = snapshot.get("job", {})
        items.append({
            "id": a.id,
            "job_id": a.job_id,
            "job_name": job_snapshot.get("name"),
            "job_snapshot": snapshot,
            "resume_id": a.resume_id,
            "status": a.status,
            "status_name": service.get_status_name(a.status),
            "create_time": a.create_time
        })
    return ApiResponse(
        data=PageData(
            total=total,
            items=items
        )
    )


@router.delete("/{app_id}", response_model=ApiResponse)
async def withdraw_application(
    app_id: int,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """撤回投递"""
    await service.withdraw_application(app_id, user_id)
    return ApiResponse(code=200, message="撤回成功")


@router.get("/{app_id}", response_model=ApiResponse[ApplicationDetail])
async def get_my_application(
    app_id: int,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """获取我的投递详情"""
    app = await service.get_application_by_id(app_id, user_id)
    # 获取简历信息
    resume = await service.get_resume_by_id(app.resume_id)
    detail = {
        "id": app.id,
        "job_id": app.job_id,
        "job_name": (app.job_snapshot or {}).get("job", {}).get("name"),
        "job_snapshot": app.job_snapshot,
        "resume_id": app.resume_id,
        "status": app.status,
        "status_name": service.get_status_name(app.status),
        "create_time": app.create_time,
        "resume_name": resume.file_name if resume else None,
        "resume_file_path": resume.file_path if resume else None
    }
    return ApiResponse(data=detail)
