from fastapi import APIRouter, Depends, Query

from app.deps import get_current_user
from app.deps import get_db
from app.core.exceptions import NotFoundError
from app.deps import get_cache
from app.services.cache_service import CacheService
from app.repositories.eval_template_repository import EvalTemplateRepository
from app.services.eval_template_service import EvalTemplateService
from app.schemas.vo.request.eval_template_request import (
    EvalDimensionAiSuggestRequest,
    EvalDimensionCreate,
    EvalDimensionUpdate,
    EvalTemplateCreate,
    EvalTemplateUpdate,
    JobTemplateAiSuggestRequest,
    TemplateSkillAiSuggestRequest,
)
from app.schemas.vo.response.eval_template_response import (
    ApiResponse,
    EvalDimensionAiSuggestResponse,
    EvalDimensionItem,
    EvalTemplateItem,
    JobTemplateAiSuggestResponse,
    PageData,
    TemplateSkillAiSuggestResponse,
)

dimension_router = APIRouter()
template_router = APIRouter()


def get_service(db=Depends(get_db), cache: CacheService = Depends(get_cache)) -> EvalTemplateService:
    return EvalTemplateService(EvalTemplateRepository(db), cache)


@dimension_router.get("", response_model=ApiResponse[PageData])
async def list_dimensions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: int = Query(None),
    search: str = Query(None),
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    skip = (page - 1) * page_size
    dimensions = await service.repo.list_dimensions(skip=skip, limit=page_size, status=status, search=search)
    total = await service.repo.count_dimensions(status=status, search=search)
    dim_ids = [d.id for d in dimensions]
    counts = await service.repo.batch_count_dimension_templates(dim_ids)
    items = []
    for dimension in dimensions:
        item = EvalDimensionItem.model_validate(dimension).model_dump()
        item["template_count"] = counts.get(dimension.id, 0)
        items.append(item)
    return ApiResponse(data=PageData(total=total, items=items))


@dimension_router.post("/ai/suggest", response_model=ApiResponse[EvalDimensionAiSuggestResponse])
async def suggest_dimension(
    body: EvalDimensionAiSuggestRequest,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[EvalDimensionAiSuggestResponse]:
    result = await service.suggest_dimension(body)
    return ApiResponse(data=EvalDimensionAiSuggestResponse(**result))


@dimension_router.get("/{dimension_id}", response_model=ApiResponse[EvalDimensionItem])
async def get_dimension(
    dimension_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    dimension = await service.repo.get_dimension(dimension_id)
    if not dimension:
        raise NotFoundError("评估维度不存在")
    item = EvalDimensionItem.model_validate(dimension).model_dump()
    item["template_count"] = await service.repo.count_dimension_templates(dimension_id)
    return ApiResponse(data=item)


@dimension_router.post("", response_model=ApiResponse[EvalDimensionItem])
async def create_dimension(
    body: EvalDimensionCreate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    dimension = await service.create_dimension(body)
    return ApiResponse(message="创建成功", data=EvalDimensionItem.model_validate(dimension))


@dimension_router.put("/{dimension_id}", response_model=ApiResponse[EvalDimensionItem])
async def update_dimension(
    dimension_id: int,
    body: EvalDimensionUpdate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    dimension = await service.update_dimension(dimension_id, body)
    return ApiResponse(message="更新成功", data=EvalDimensionItem.model_validate(dimension))


@dimension_router.delete("/{dimension_id}", response_model=ApiResponse)
async def delete_dimension(
    dimension_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    await service.delete_dimension(dimension_id)
    return ApiResponse(message="删除成功")


async def build_template_item(service: EvalTemplateService, template_id: int, job_counts: dict[int, int] = None, published_counts: dict[int, int] = None) -> dict:
    detail = await service.repo.get_template_detail(template_id)
    if not detail:
        raise NotFoundError("评估模板不存在")
    detail["job_count"] = (job_counts or {}).get(template_id, 0)
    detail["published_job_count"] = (published_counts or {}).get(template_id, 0)
    return detail


@template_router.get("", response_model=ApiResponse[PageData])
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
    if templates:
        template_ids = [t.id for t in templates]
        job_counts = await service.repo.batch_count_template_jobs(template_ids)
        published_counts = await service.repo.batch_count_template_jobs(template_ids, status=1)
        items = [await build_template_item(service, t.id, job_counts, published_counts) for t in templates]
    else:
        items = []
    return ApiResponse(data=PageData(total=total, items=items))


@template_router.post("/skills/ai/suggest", response_model=ApiResponse[TemplateSkillAiSuggestResponse])
async def suggest_template_skills(
    body: TemplateSkillAiSuggestRequest,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[TemplateSkillAiSuggestResponse]:
    result = await service.suggest_template_skills(body)
    return ApiResponse(data=TemplateSkillAiSuggestResponse(**result))


@template_router.post("/ai/suggest", response_model=ApiResponse[JobTemplateAiSuggestResponse])
async def suggest_job_template(
    body: JobTemplateAiSuggestRequest,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[JobTemplateAiSuggestResponse]:
    result = await service.suggest_job_template(body)
    return ApiResponse(data=JobTemplateAiSuggestResponse(**result))


@template_router.get("/{template_id}", response_model=ApiResponse[EvalTemplateItem])
async def get_template(
    template_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    return ApiResponse(data=await build_template_item(service, template_id))


@template_router.post("", response_model=ApiResponse[EvalTemplateItem])
async def create_template(
    body: EvalTemplateCreate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    template = await service.create_template(body)
    return ApiResponse(message="创建成功", data=await build_template_item(service, template.id))


@template_router.put("/{template_id}", response_model=ApiResponse[EvalTemplateItem])
async def update_template(
    template_id: int,
    body: EvalTemplateUpdate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    template = await service.update_template(template_id, body)
    return ApiResponse(message="更新成功", data=await build_template_item(service, template.id))


@template_router.delete("/{template_id}", response_model=ApiResponse)
async def delete_template(
    template_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    await service.delete_template(template_id)
    return ApiResponse(message="删除成功")