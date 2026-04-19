from app.repositories.job_repo import JobRepository
from app.models.job_position import JobPosition
from app.core.exceptions import NotFoundError


class JobService:
    def __init__(self, job_repo: JobRepository):
        self.job_repo = job_repo

    async def get_jobs(self, skip: int = 0, limit: int = 20) -> tuple[list[JobPosition], int]:
        """获取岗位列表（用户端）"""
        jobs = await self.job_repo.get_list(skip=skip, limit=limit, status=1)
        total = await self.job_repo.get_count(status=1)
        return jobs, total

    async def get_job_by_id(self, job_id: int) -> JobPosition:
        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")
        return job

    async def get_employee_jobs(self, employee_id: int) -> list[JobPosition]:
        """获取员工发布的岗位"""
        return await self.job_repo.get_by_employee(employee_id)

    async def create_job(self, employee_id: int, dept_id: int, name: str, description: str) -> JobPosition:
        return await self.job_repo.create(employee_id, dept_id, name, description)

    async def update_job(self, job_id: int, **kwargs) -> JobPosition:
        return await self.job_repo.update(job_id, **kwargs)

    async def delete_job(self, job_id: int) -> bool:
        return await self.job_repo.delete(job_id)
