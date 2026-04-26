from fastapi import APIRouter, Depends
from app.repositories.job_repo import JobRepository
from app.services.job_service import JobService
from app.schemas.job import DimensionCreate, DimensionItem
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse
from typing import List

router = APIRouter()


def get_repo(db=Depends(get_db)) -> JobRepository:
    return JobRepository(db)


@router.get("/{job_id}/dimensions", response_model=ApiResponse[List[DimensionItem]])
async def list_dimensions(
    job_id: int,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    dims = await repo.get_dimensions(job_id)
    return ApiResponse(data=[DimensionItem.model_validate(d) for d in dims])


@router.post("/{job_id}/dimensions", response_model=ApiResponse[DimensionItem])
async def add_dimension(
    job_id: int,
    body: DimensionCreate,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    await JobService(repo).ensure_job_editable(job_id)
    dim = await repo.add_dimension(
        job_id=job_id,
        dimension_name=body.dimension_name,
        weight=body.weight,
        prompt_template=body.prompt_template,
        sort_order=body.sort_order,
    )
    return ApiResponse(data=DimensionItem.model_validate(dim))


@router.put("/{job_id}/dimensions/{dim_id}", response_model=ApiResponse[DimensionItem])
async def update_dimension(
    job_id: int,
    dim_id: int,
    body: DimensionCreate,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    await JobService(repo).ensure_job_editable(job_id)
    dim = await repo.update_dimension(
        dim_id,
        dimension_name=body.dimension_name,
        weight=body.weight,
        prompt_template=body.prompt_template,
        sort_order=body.sort_order,
    )
    return ApiResponse(data=DimensionItem.model_validate(dim))


@router.delete("/{job_id}/dimensions/{dim_id}", response_model=ApiResponse)
async def delete_dimension(
    job_id: int,
    dim_id: int,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    await JobService(repo).ensure_job_editable(job_id)
    await repo.delete_dimension(dim_id)
    return ApiResponse(message="删除成功")
