from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, get_db
from app.repositories.eval_template_repo import EvalTemplateRepository
from app.schemas.eval_template import EvalDimensionCreate, EvalDimensionItem, EvalDimensionUpdate
from app.schemas.response import ApiResponse, PageData
from app.services.eval_template_service import EvalTemplateService

router = APIRouter()


def get_service(db=Depends(get_db)) -> EvalTemplateService:
    return EvalTemplateService(EvalTemplateRepository(db))


@router.get("", response_model=ApiResponse[PageData])
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
    items = []
    for dimension in dimensions:
        item = EvalDimensionItem.model_validate(dimension).model_dump()
        item["template_count"] = await service.repo.count_dimension_templates(dimension.id)
        items.append(item)
    return ApiResponse(data=PageData(total=total, items=items))


@router.get("/{dimension_id}", response_model=ApiResponse[EvalDimensionItem])
async def get_dimension(
    dimension_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    dimension = await service.repo.get_dimension(dimension_id)
    if not dimension:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("评估维度不存在")
    item = EvalDimensionItem.model_validate(dimension).model_dump()
    item["template_count"] = await service.repo.count_dimension_templates(dimension_id)
    return ApiResponse(data=item)


@router.post("", response_model=ApiResponse[EvalDimensionItem])
async def create_dimension(
    body: EvalDimensionCreate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    dimension = await service.create_dimension(body)
    return ApiResponse(message="创建成功", data=EvalDimensionItem.model_validate(dimension))


@router.put("/{dimension_id}", response_model=ApiResponse[EvalDimensionItem])
async def update_dimension(
    dimension_id: int,
    body: EvalDimensionUpdate,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    dimension = await service.update_dimension(dimension_id, body)
    return ApiResponse(message="更新成功", data=EvalDimensionItem.model_validate(dimension))


@router.delete("/{dimension_id}", response_model=ApiResponse)
async def delete_dimension(
    dimension_id: int,
    service: EvalTemplateService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    await service.delete_dimension(dimension_id)
    return ApiResponse(message="删除成功")
