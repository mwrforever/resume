from app.modules.job.repository import JobRepository
from app.models.job_position import JobPosition
from app.infrastructure.exception import NotFoundError, ValidationError
from app.infrastructure.cache import CacheService
from app.infrastructure.cache.redis_constants import (
    JOB_SKILLS_KEY,
    JOB_SKILLS_TTL,
    JOB_DETAIL_KEY,
    JOB_LIST_KEY,
    JOB_COUNT_ACTIVE_KEY,
)


class JobService:
    def __init__(self, job_repo: JobRepository, cache: CacheService | None = None):
        self.job_repo = job_repo
        self.cache = cache

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

    async def get_jobs_with_skills(self, skip: int = 0, limit: int = 20) -> tuple[list[JobPosition], int, dict[int, list[str]]]:
        """获取岗位列表及技能（批量）"""
        jobs = await self.job_repo.get_list(skip=skip, limit=limit, status=1)
        total = await self.job_repo.get_count(status=1)
        if not jobs:
            return jobs, total, {}
        job_ids = [j.id for j in jobs]
        skills_map = await self.job_repo.get_skills_by_job_ids(job_ids, limit=5)
        # 转换为 {job_id: [skill_name,...]}
        return jobs, total, skills_map

    async def get_job_skills(self, job_id: int, limit: int = 100) -> list[str]:
        """获取岗位技能列表（单个岗位）"""
        key = JOB_SKILLS_KEY.format(job_id=job_id)
        if self.cache:
            cached = await self.cache.get_json(key)
            if cached is not None:
                return cached
        skills = await self.job_repo.get_skills_by_job_ids([job_id], limit=limit)
        result = skills.get(job_id, [])
        if self.cache:
            await self.cache.set_json(key, result, JOB_SKILLS_TTL)
        return result

    async def create_job(
        self,
        employee_id: int,
        dept_id: int,
        name: str,
        description: str = None,
        template_id: int = None,
    ) -> JobPosition:
        job = await self.job_repo.create(employee_id, dept_id, name, description, template_id)
        if self.cache:
            await self.cache.delete_pattern(JOB_LIST_KEY.format(page="*", size="*"))
            await self.cache.delete(JOB_COUNT_ACTIVE_KEY)
        return job

    async def update_job(self, job_id: int, **kwargs) -> JobPosition:
        job = await self.job_repo.update(job_id, **kwargs)
        if self.cache:
            await self.cache.delete(JOB_DETAIL_KEY.format(job_id=job_id))
            await self.cache.delete(JOB_SKILLS_KEY.format(job_id=job_id))
        return job

    async def ensure_job_editable(self, job_id: int) -> None:
        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")
        if job.status == 1:
            raise ValidationError("招聘中的岗位不能编辑")
        application_count = await self.job_repo.count_applications(job_id)
        if application_count > 0:
            raise ValidationError("已有投递的岗位不能编辑")

    async def delete_job(self, job_id: int) -> bool:
        result = await self.job_repo.delete(job_id)
        if self.cache:
            await self.cache.delete(JOB_DETAIL_KEY.format(job_id=job_id))
            await self.cache.delete_pattern(JOB_LIST_KEY.format(page="*", size="*"))
            await self.cache.delete(JOB_SKILLS_KEY.format(job_id=job_id))
            await self.cache.delete(JOB_COUNT_ACTIVE_KEY)
        return result
