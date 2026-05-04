from fastapi import APIRouter, Depends, Query
from app.deps import get_db
from app.services.cache_service import get_cache, CacheService
from app.utils.cache_utils import TAG_LIST_KEY, TAG_LIST_TTL
from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.tag_repository import TagRepository

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
        cache: CacheService = Depends(get_cache),
):
    if page is None:
        key = TAG_LIST_KEY.format(tag_type=tag_type) if tag_type is not None else TAG_LIST_KEY.format(tag_type="all")
        cached = await cache.get_json(key)
        if cached is not None:
            return ApiResponse(data=cached)
        tags = await repo.list_tags(tag_type=tag_type)
        tag_list = [TagItem.model_validate(t).model_dump() for t in tags]
        await cache.set_json(key, tag_list, TAG_LIST_TTL)
        return ApiResponse(data=[TagItem.model_validate(t) for t in tags])
    skip = (page - 1) * page_size
    tags = await repo.list_page(skip=skip, limit=page_size, tag_type=tag_type, status=status, search=search)
    total = await repo.get_count(tag_type=tag_type, status=status, search=search)
    tag_ids = [t.id for t in tags]
    counts = await repo.batch_count_job_associations(tag_ids)
    items = []
    for tag in tags:
        item = TagItem.model_validate(tag).model_dump()
        item["job_count"] = counts.get(tag.id, 0)
        items.append(item)
    return ApiResponse(data=PageData(total=total, items=items))


@router.get("/{tag_id}", response_model=ApiResponse)
async def get_tag(
        tag_id: int,
        repo: TagRepository = Depends(get_repo),
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
        cache: CacheService = Depends(get_cache),
):
    tag = await repo.create(
        tag_name=body.tag_name,
        tag_type=body.tag_type,
        sort_order=body.sort_order,
        status=body.status,
        color=body.color,
    )
    key = TAG_LIST_KEY.format(tag_type=body.tag_type) if body.tag_type is not None else TAG_LIST_KEY.format(
        tag_type="all")
    await cache.delete(key)
    return ApiResponse(message="创建成功", data=TagItem.model_validate(tag))


@router.put("/{tag_id}", response_model=ApiResponse[TagItem])
async def update_tag(
        tag_id: int,
        body: TagUpdate,
        repo: TagRepository = Depends(get_repo),
        cache: CacheService = Depends(get_cache),
):
    tag = await repo.get_by_id(tag_id)
    if not tag:
        raise NotFoundError("标签不存在")
    if await repo.count_job_associations(tag_id) > 0:
        raise ValidationError("已有评估模板引用该标签，不允许修改")
    payload = body.model_dump(exclude_unset=True)
    if payload:
        tag = await repo.update(tag_id, **payload)
    key = TAG_LIST_KEY.format(tag_type=body.tag_type) if body.tag_type is not None else TAG_LIST_KEY.format(
        tag_type="all")
    await cache.delete(key)
    return ApiResponse(message="更新成功", data=TagItem.model_validate(tag))


@router.delete("/{tag_id}", response_model=ApiResponse)
async def delete_tag(
        tag_id: int,
        repo: TagRepository = Depends(get_repo),
        cache: CacheService = Depends(get_cache),
):
    tag = await repo.get_by_id(tag_id)
    if not tag:
        raise NotFoundError("标签不存在")
    if await repo.count_job_associations(tag_id) > 0:
        raise ValidationError("已有评估模板引用该标签，不允许删除")
    await repo.delete(tag_id)
    await cache.delete(TAG_LIST_KEY.format(tag_type="all"))
    return ApiResponse(message="删除成功")