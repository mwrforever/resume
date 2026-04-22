from fastapi import APIRouter, Depends, Query
from app.services.application_service import ApplicationService
from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse, EmployeeApplicationItem, PageData

router = APIRouter()

STATUS_NAMES = {
    0: "已取消",
    1: "待处理",
    2: "已查看",
    3: "面试中",
    4: "已拒绝",
    5: "已录用",
}


def get_service(db=Depends(get_db)) -> ApplicationService:
    return ApplicationService(
        ApplicationRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.get("", response_model=ApiResponse[PageData])
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

    items = [
        EmployeeApplicationItem(
            id=a.id,
            user_id=a.user_id,
            job_id=a.job_id,
            resume_id=a.resume_id,
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
