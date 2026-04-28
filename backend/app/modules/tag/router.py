from fastapi import APIRouter, Depends, Query
from app.modules.tag.repository import TagRepository
from app.schemas.vo.request.tag_request import TagCreate, TagUpdate
from app.schemas.vo.response.tag_response import ApiResponse, PageData, TagItem
from app.api.deps import get_db, get_current_user
from app.core.exceptions import NotFoundError, ValidationError
from typing import Optional

router = APIRouter()


def get_repo(db=Depends(get_db)) -> TagRepository:
    return TagRepository(db)


@router.get("", response_model=ApiResponse)
async def list_tags(
    tag_type: Optional[int] = Query(None),
    status: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    repo: TagRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    if page is None:
        tags = await repo.list_tags(tag_type=tag_type)
        return ApiResponse(data=[TagItem.model_validate(t) for t in tags])
    skip = (page - 1) * page_size
    tags = await repo.list_page(skip=skip, limit=page_size, tag_type=tag_type, status=status, search=search)
    total = await repo.get_count(tag_type=tag_type, status=status, search=search)
    items = []
    for tag in tags:
        item = TagItem.model_validate(tag).model_dump()
        item["job_count"] = await repo.count_job_associations(tag.id)
        items.append(item)
    return ApiResponse(data=PageData(total=total, items=items))


@router.get("/{tag_id}", response_model=ApiResponse)
async def get_tag(
    tag_id: int,
    repo: TagRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    tag = await repo.get_by_id(tag_id)
    if not tag:
        raise NotFoundError("标签不存在")
    data = TagItem.model_validate(tag).model_dump()
    data["job_count"] = await repo.count_job_associations(tag_id)
    return ApiResponse(data=data)


@router.post("", response_model=ApiResponse[TagItem])
async def create_tag(
    body: TagCreate,
    repo: TagRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    tag = await repo.create(
        tag_name=body.tag_name,
        tag_type=body.tag_type,
        sort_order=body.sort_order,
        status=body.status,
        color=body.color,
    )
    return ApiResponse(message="创建成功", data=TagItem.model_validate(tag))


@router.put("/{tag_id}", response_model=ApiResponse[TagItem])
async def update_tag(
    tag_id: int,
    body: TagUpdate,
    repo: TagRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    tag = await repo.get_by_id(tag_id)
    if not tag:
        raise NotFoundError("标签不存在")
    if await repo.count_job_associations(tag_id) > 0:
        raise ValidationError("已有评估模板引用该标签，不允许修改")
    payload = body.model_dump(exclude_unset=True)
    if payload:
        tag = await repo.update(tag_id, **payload)
    return ApiResponse(message="更新成功", data=TagItem.model_validate(tag))


@router.delete("/{tag_id}", response_model=ApiResponse)
async def delete_tag(
    tag_id: int,
    repo: TagRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    tag = await repo.get_by_id(tag_id)
    if not tag:
        raise NotFoundError("标签不存在")
    if await repo.count_job_associations(tag_id) > 0:
        raise ValidationError("已有评估模板引用该标签，不允许删除")
    await repo.delete(tag_id)
    return ApiResponse(message="删除成功")

