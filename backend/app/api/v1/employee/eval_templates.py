from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, get_db
from app.core.exceptions import NotFoundError
from app.repositories.eval_template_repo import EvalTemplateRepository
from app.schemas.eval_template import EvalTemplateCreate, EvalTemplateItem, EvalTemplateUpdate
from app.schemas.response import ApiResponse, PageData
from app.services.eval_template_service import EvalTemplateService

router = APIRouter()


def get_service(db=Depends(get_db)) -> EvalTemplateService:
    return EvalTemplateService(EvalTemplateRepository(db))


async def build_template_item(service: EvalTemplateService, template_id: int) -> dict:
    detail = await service.repo.get_template_detail(template_id)
    if not detail:
        raise NotFoundError("评估模板不存在")
    detail["job_count"] = await service.repo.count_template_jobs(template_id)
    detail["published_job_count"] = await service.repo.count_template_jobs(template_id, status=1)
    return detail


@router.get("", response_model=ApiResponse[PageData])
async def list_templates(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: int = Query(None),
    search: str = Query(None),
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    skip = (page - 1) * page_size
    templates = await service.repo.list_templates(skip=skip, limit=page_size, status=status, search=search)
    total = await service.repo.count_templates(status=status, search=search)
    items = [await build_template_item(service, template.id) for template in templates]
    return ApiResponse(data=PageData(total=total, items=items))


@router.get("/{template_id}", response_model=ApiResponse[EvalTemplateItem])
async def get_template(
    template_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    return ApiResponse(data=await build_template_item(service, template_id))


@router.post("", response_model=ApiResponse[EvalTemplateItem])
async def create_template(
    body: EvalTemplateCreate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    template = await service.create_template(body)
    return ApiResponse(message="创建成功", data=await build_template_item(service, template.id))


@router.put("/{template_id}", response_model=ApiResponse[EvalTemplateItem])
async def update_template(
    template_id: int,
    body: EvalTemplateUpdate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    template = await service.update_template(template_id, body)
    return ApiResponse(message="更新成功", data=await build_template_item(service, template.id))


@router.delete("/{template_id}", response_model=ApiResponse)
async def delete_template(
    template_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    await service.delete_template(template_id)
    return ApiResponse(message="删除成功")
