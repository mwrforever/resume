from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.job_position import JobPosition
from app.models.job_skill import JobSkill


class JobRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, job_id: int) -> JobPosition:
        result = await self.db.execute(
            select(JobPosition).where(JobPosition.id == job_id, JobPosition.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_list(self, skip: int = 0, limit: int = 20, status: int = 1) -> list[JobPosition]:
        """获取岗位列表（用户端：只看招聘中的）
        使用 ORDER BY id 确保分页结果不重复/遗漏
        """
        query = select(JobPosition).where(JobPosition.is_deleted == 0)
        if status is not None:
            query = query.where(JobPosition.status == status)
        query = query.order_by(JobPosition.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_count(self, status: int = 1) -> int:
        """获取岗位总数"""
        from sqlalchemy import func
        query = select(func.count(JobPosition.id)).where(
            JobPosition.is_deleted == 0,
            JobPosition.status == status
        )
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_by_employee(self, employee_id: int) -> list[JobPosition]:
        """获取员工发布的岗位"""
        result = await self.db.execute(
            select(JobPosition)
            .where(JobPosition.employee_id == employee_id, JobPosition.is_deleted == 0)
            .order_by(JobPosition.create_time.desc())
        )
        return result.scalars().all()

    async def create(self, employee_id: int, dept_id: int, name: str, description: str) -> JobPosition:
        job = JobPosition(
            employee_id=employee_id,
            dept_id=dept_id,
            name=name,
            description=description
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def update(self, job_id: int, **kwargs) -> JobPosition:
        await self.db.execute(
            update(JobPosition).where(JobPosition.id == job_id).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_by_id(job_id)

    async def get_skills_by_job_ids(self, job_ids: list[int], limit: int = 5) -> dict[int, list[JobSkill]]:
        """批量获取岗位技能（按skill_type升序，返回前limit个），返回 {job_id: [skills]}"""
        if not job_ids:
            return {}
        result = await self.db.execute(
            select(JobSkill)
            .where(JobSkill.job_id.in_(job_ids))
            .order_by(JobSkill.skill_type.asc())
        )
        skills_map: dict[int, list[JobSkill]] = {job_id: [] for job_id in job_ids}
        for skill in result.scalars().all():
            if len(skills_map[skill.job_id]) < limit:
                skills_map[skill.job_id].append(skill)
        return skills_map

    async def delete(self, job_id: int) -> bool:
        await self.db.execute(
            update(JobPosition).where(JobPosition.id == job_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True
