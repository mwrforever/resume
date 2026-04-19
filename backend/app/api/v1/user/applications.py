from fastapi import APIRouter, Depends, Query
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.schemas.application import ApplyRequest
from app.api.deps import get_db, get_current_user

router = APIRouter()


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


def get_user_id(current_user: dict = Depends(get_current_user)) -> int:
    return int(current_user["sub"])


@router.post("")
async def apply_job(
    req: ApplyRequest,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """投递岗位（必须关联附件简历）"""
    app = await service.create_application(user_id, req.job_id, req.resume_id)
    return {"code": 200, "message": "投递成功", "data": {"id": app.id}}


@router.get("")
async def list_my_applications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """获取我的投递列表"""
    skip = (page - 1) * page_size
    apps, total = await service.get_user_applications(user_id, skip, page_size)

    # TODO: 补充岗位名称、简历名称等信息
    return {"code": 200, "message": "success", "data": {
        "total": total,
        "items": [
            {
                "id": a.id,
                "job_id": a.job_id,
                "resume_id": a.resume_id,
                "status": a.status,
                "status_name": service.get_status_name(a.status),
                "create_time": a.create_time.isoformat() if a.create_time else None
            } for a in apps
        ]
    }}


@router.get("/{app_id}")
async def get_my_application(
    app_id: int,
    service: ApplicationService = Depends(get_service),
    user_id: int = Depends(get_user_id)
):
    """获取我的投递详情"""
    app = await service.get_application_by_id(app_id, user_id)

    # TODO: 补充岗位信息、简历信息、评估信息
    return {"code": 200, "message": "success", "data": {
        "id": app.id,
        "job_id": app.job_id,
        "resume_id": app.resume_id,
        "status": app.status,
        "status_name": service.get_status_name(app.status),
        "create_time": app.create_time.isoformat() if app.create_time else None,
        "evaluation": None  # TODO: 如果已评估，补充评估结果
    }}