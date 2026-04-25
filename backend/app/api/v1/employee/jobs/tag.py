from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.repositories.job_repo import JobRepository
from app.schemas.job import TagItem
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse
from typing import List

router = APIRouter()


class SetTagsRequest(BaseModel):
    tag_ids: List[int]


def get_repo(db=Depends(get_db)) -> JobRepository:
    return JobRepository(db)


@router.get("/{job_id}/tags", response_model=ApiResponse[List[TagItem]])
async def get_job_tags(
    job_id: int,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    tags = await repo.get_job_tags(job_id)
    return ApiResponse(data=[TagItem.model_validate(t) for t in tags])


@router.put("/{job_id}/tags", response_model=ApiResponse)
async def set_job_tags(
    job_id: int,
    body: SetTagsRequest,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    await repo.set_job_tags(job_id, body.tag_ids)
    return ApiResponse(message="标签设置成功")
