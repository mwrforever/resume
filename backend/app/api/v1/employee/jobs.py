from fastapi import APIRouter, Depends, Query
from app.services.job_service import JobService
from app.repositories.job_repo import JobRepository
from app.schemas.job import JobCreate, JobUpdate
from app.api.deps import get_db, get_current_user

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


@router.get("")
async def list_employee_jobs(
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：岗位列表"""
    employee_id = int(current_user["sub"])
    jobs = await service.get_employee_jobs(employee_id)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "items": [
                {
                    "id": j.id,
                    "name": j.name,
                    "description": j.description,
                    "status": j.status,
                    "create_time": j.create_time.isoformat() if j.create_time else None
                } for j in jobs
            ]
        }
    }


@router.post("")
async def create_job(
    job: JobCreate,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：创建岗位"""
    employee_id = int(current_user["sub"])
    new_job = await service.create_job(employee_id, job.dept_id, job.name, job.description)
    return {"code": 200, "message": "创建成功", "data": {"id": new_job.id}}


@router.put("/{job_id}")
async def update_job(
    job_id: int,
    job: JobUpdate,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：编辑岗位"""
    updated_job = await service.update_job(job_id, **job.model_dump(exclude_unset=True))
    return {"code": 200, "message": "更新成功", "data": None}


@router.delete("/{job_id}")
async def delete_job(
    job_id: int,
    service: JobService = Depends(get_job_service),
    current_user: dict = Depends(get_current_user)
):
    """员工端：删除岗位"""
    await service.delete_job(job_id)
    return {"code": 200, "message": "删除成功", "data": None}
