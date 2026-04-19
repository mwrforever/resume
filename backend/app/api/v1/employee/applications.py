from fastapi import APIRouter, Depends, Query
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user

router = APIRouter()


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.get("")
async def list_applications(
    job_id: int = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """获取投递列表（员工端）"""
    if job_id:
        apps, total = await service.get_job_applications(job_id, (page-1)*page_size, page_size)
    else:
        apps, total = [], 0

    return {"code": 200, "message": "success", "data": {
        "total": total,
        "items": [
            {
                "id": a.id,
                "user_id": a.user_id,
                "job_id": a.job_id,
                "resume_id": a.resume_id,
                "status": a.status,
                "status_name": service.get_status_name(a.status),
                "create_time": a.create_time.isoformat() if a.create_time else None
            } for a in apps
        ]
    }}


@router.put("/{app_id}/status")
async def update_application_status(
    app_id: int,
    status: int,
    service: ApplicationService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """更新投递状态"""
    await service.update_status(app_id, status)
    return {"code": 200, "message": "更新成功", "data": None}