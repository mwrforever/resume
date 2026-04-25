from fastapi import APIRouter, Depends, Query
from app.repositories.tag_repo import TagRepository
from app.schemas.job import TagItem
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse
from typing import List, Optional

router = APIRouter()


def get_repo(db=Depends(get_db)) -> TagRepository:
    return TagRepository(db)


@router.get("", response_model=ApiResponse[List[TagItem]])
async def list_tags(
    tag_type: Optional[int] = Query(None),
    repo: TagRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    """列出所有可用标签（用于岗位 tag 选择弹窗）"""
    tags = await repo.list_tags(tag_type=tag_type)
    return ApiResponse(data=[TagItem.model_validate(t) for t in tags])
