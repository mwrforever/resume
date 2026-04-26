from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db, get_current_user
from app.models.job_position import JobPosition
from app.models.sys_dept import SysDept
from app.repositories.job_repo import JobRepository
from app.repositories.eval_template_repo import EvalTemplateRepository
from app.services.job_service import JobService
from app.services.eval_template_service import EvalTemplateService
from app.schemas.response import ApiResponse, JobItem, PageData
from app.schemas.job import JobCreate, JobUpdate

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


def get_template_service(db=Depends(get_db)) -> EvalTemplateService:
    return EvalTemplateService(EvalTemplateRepository(db))


async def _build_job_item(job, dept, service: JobService) -> JobItem:
    data = JobItem.model_validate(job).model_dump()
    data["dept_name"] = dept.dept_name if dept else None
    data["dept_code"] = dept.dept_code if dept else None
    data["resume_count"] = await service.job_repo.count_applications(job.id)
    data["template_id"] = job.template_id
    return JobItem.model_validate(data)


@router.get("", response_model=ApiResponse[PageData])
async def list_employee_jobs(
    status: int = Query(None),
    search: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：岗位列表（全部岗位，可按状态/关键词筛选）"""
    skip = (page - 1) * page_size
    rows = await service.job_repo.get_list_with_dept(skip=skip, limit=page_size, status=status, search=search)
    total = await service.job_repo.get_count(status=status, search=search)
    return ApiResponse(
        data=PageData(
            total=total,
            items=[await _build_job_item(job, dept, service) for job, dept in rows]
        )
    )


@router.get("/{job_id}", response_model=ApiResponse)
async def get_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    template_service: EvalTemplateService = Depends(get_template_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：获取岗位详情（含维度、技能、标签）"""
    from fastapi import HTTPException
    row = await service.job_repo.get_by_id_with_dept(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="岗位不存在")
    job, dept = row
    item = await _build_job_item(job, dept, service)
    data = item.model_dump()
    data["template"] = await template_service.repo.get_template_detail(job.template_id) if job.template_id else None
    if data["template"]:
        data["dimensions"] = data["template"]["dimensions"]
        data["skills"] = data["template"]["skills"]
        data["tags"] = data["template"]["tags"]
    else:
        data["dimensions"] = []
        data["skills"] = []
        data["tags"] = []
    return ApiResponse(data=data)


@router.post("", response_model=ApiResponse)
async def create_job(
    job: JobCreate,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：创建岗位（含维度、技能、标签）"""
    employee_id = int(current_user["sub"])
    new_job = await service.create_job(
        employee_id,
        job.dept_id,
        job.name,
        job.description,
        template_id=job.template_id,
    )
    return ApiResponse(code=200, message="创建成功", data={"id": new_job.id})


@router.put("/{job_id}", response_model=ApiResponse)
async def update_job(
    job_id: int,
    job: JobUpdate,
    service: JobService = Depends(get_job_service),
    template_service: EvalTemplateService = Depends(get_template_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：编辑岗位"""
    payload = job.model_dump(exclude_unset=True)
    is_status_only = set(payload.keys()) <= {"status"}
    if payload.get("status") == 1:
        current_job = await service.get_job_by_id(job_id)
        if not current_job.template_id:
            from app.core.exceptions import ValidationError
            raise ValidationError("岗位发布前必须绑定评估模板")
        await template_service.validate_template_available(current_job.template_id)
    if not is_status_only:
        await service.ensure_job_editable(job_id)
    if payload:
        await service.update_job(job_id, **payload)
    return ApiResponse(message="更新成功")


@router.delete("/{job_id}", response_model=ApiResponse)
async def delete_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：删除岗位"""
    await service.delete_job(job_id)
    return ApiResponse(code=200, message="删除成功")
