from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db, get_current_user
from app.models.job_position import JobPosition
from app.models.sys_dept import SysDept
from app.repositories.job_repo import JobRepository
from app.schemas.job import JobCreate, JobUpdate, DimensionItem, SkillItem, TagItem
from app.schemas.response import ApiResponse, JobItem, PageData
from app.services.job_service import JobService

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


async def _build_job_item(job: "JobPosition", dept: "SysDept | None", service: JobService) -> JobItem:
    item = JobItem.model_validate(job)
    if dept:
        item.dept_name = dept.dept_name
        item.dept_code = dept.dept_code
    item.resume_count = await service.job_repo.count_applications(job.id)
    return item


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
    current_user: dict = Depends(get_current_user)
):
    """员工端：获取岗位详情（含维度、技能、标签）"""
    from fastapi import HTTPException
    row = await service.job_repo.get_by_id_with_dept(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="岗位不存在")
    job, dept = row
    item = await _build_job_item(job, dept, service)
    dimensions = await service.job_repo.get_dimensions(job_id)
    skills = await service.job_repo.get_job_skills(job_id)
    tags = await service.job_repo.get_job_tags(job_id)
    data = item.model_dump()
    data["dimensions"] = [DimensionItem.model_validate(d).model_dump() for d in dimensions]
    data["skills"] = [SkillItem.model_validate(s).model_dump() for s in skills]
    data["tags"] = [TagItem.model_validate(t).model_dump() for t in tags]
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
        dimensions=[d.model_dump() for d in job.dimensions],
        skills=[s.model_dump() for s in job.skills],
        tag_ids=job.tag_ids,
    )
    return ApiResponse(code=200, message="创建成功", data={"id": new_job.id})


@router.put("/{job_id}", response_model=ApiResponse)
async def update_job(
    job_id: int,
    job: JobUpdate,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：编辑岗位"""
    payload = job.model_dump(exclude_unset=True)
    tag_ids = payload.pop("tag_ids", None)
    is_status_only = set(payload.keys()) <= {"status"} and tag_ids is None
    if not is_status_only:
        await service.ensure_job_editable(job_id)
    if payload:
        await service.update_job(job_id, **payload)
    if tag_ids is not None:
        await service.job_repo.set_job_tags(job_id, tag_ids)
    return ApiResponse(code=200, message="更新成功")


@router.delete("/{job_id}", response_model=ApiResponse)
async def delete_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：删除岗位"""
    await service.delete_job(job_id)
    return ApiResponse(code=200, message="删除成功")
