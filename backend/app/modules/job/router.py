import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user, get_current_user_optional, get_db
from app.core.exceptions import ValidationError
from app.modules.application.repository import ApplicationRepository
from app.modules.eval_template.repository import EvalTemplateRepository
from app.modules.eval_template.service import EvalTemplateService
from app.modules.job.repository import JobRepository
from app.modules.job.service import JobService
from app.schemas.job import AiSuggestRequest, AiSuggestResponse, JobCreate, JobUpdate
from app.schemas.response import ApiResponse, JobDetail, JobItem, PageData
from app.utils.ai.chains import JobAiSuggestChain

employee_ai_router = APIRouter()
employee_router = APIRouter()
user_router = APIRouter()

_chain = JobAiSuggestChain()


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


@user_router.get("", response_model=ApiResponse[PageData])
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


@user_router.get("/{job_id}", response_model=ApiResponse[JobDetail])
async def get_user_job(
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


@employee_ai_router.post("/ai/suggest", response_model=ApiResponse[AiSuggestResponse])
async def ai_suggest(
    req: AiSuggestRequest,
):
    """根据岗位名称和已有描述，AI润色生成更详细的岗位描述（不落库）"""
    result = await asyncio.to_thread(_chain.suggest, req.name, req.description or "")

    return ApiResponse(data=AiSuggestResponse(
        comprehensive_description=result.get("comprehensive_description", ""),
        dimensions=[],
        skills=[],
    ))


@employee_router.get("", response_model=ApiResponse[PageData])
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


@employee_router.get("/{job_id}", response_model=ApiResponse)
async def get_employee_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    template_service: EvalTemplateService = Depends(get_template_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：获取岗位详情（含维度、技能、标签）"""
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


@employee_router.post("", response_model=ApiResponse)
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


@employee_router.put("/{job_id}", response_model=ApiResponse)
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
            raise ValidationError("岗位发布前必须绑定评估模板")
        await template_service.validate_template_available(current_job.template_id)
    if not is_status_only:
        await service.ensure_job_editable(job_id)
    if payload:
        await service.update_job(job_id, **payload)
    return ApiResponse(message="更新成功")


@employee_router.delete("/{job_id}", response_model=ApiResponse)
async def delete_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：删除岗位"""
    await service.delete_job(job_id)
    return ApiResponse(code=200, message="删除成功")


__all__ = ["employee_ai_router", "employee_router", "user_router"]
