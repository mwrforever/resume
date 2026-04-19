from fastapi import APIRouter, Depends, Query
from app.services.job_service import JobService
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db

router = APIRouter()


def get_job_service(db=Depends(get_db)) -> JobService:
    return JobService(JobRepository(db))


@router.get("")
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    service: JobService = Depends(get_job_service)
):
    """用户端：浏览岗位列表"""
    skip = (page - 1) * page_size
    jobs, total = await service.get_jobs(skip=skip, limit=page_size)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "total": total,
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


@router.get("/{job_id}")
async def get_job(
    job_id: int,
    service: JobService = Depends(get_job_service)
):
    """用户端：查看岗位详情"""
    job = await service.get_job_by_id(job_id)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": job.id,
            "name": job.name,
            "description": job.description,
            "status": job.status,
            "create_time": job.create_time.isoformat() if job.create_time else None
        }
    }
