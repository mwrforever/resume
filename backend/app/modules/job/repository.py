from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.eval_template_skill import EvalTemplateSkill
from app.models.job_position import JobPosition
from app.models.job_application import JobApplication
from app.models.sys_dept import SysDept


class JobRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, job_id: int) -> JobPosition:
        result = await self.db.execute(
            select(JobPosition).where(JobPosition.id == job_id, JobPosition.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_id_with_dept(self, job_id: int) -> tuple[JobPosition, SysDept | None] | None:
        result = await self.db.execute(
            select(JobPosition, SysDept)
            .outerjoin(SysDept, (SysDept.id == JobPosition.dept_id) & (SysDept.is_deleted == 0))
            .where(JobPosition.id == job_id, JobPosition.is_deleted == 0)
        )
        return result.first()

    async def get_list(self, skip: int = 0, limit: int = 20, status: int = 1, search: str = None) -> list[JobPosition]:
        """获取岗位列表（用户端：只看招聘中的）
        使用 ORDER BY id 确保分页结果不重复/遗漏
        """
        query = select(JobPosition).where(JobPosition.is_deleted == 0)
        if status is not None:
            query = query.where(JobPosition.status == status)
        if search:
            query = query.where(JobPosition.name.ilike(f"%{search}%"))
        query = query.order_by(JobPosition.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_list_with_dept(self, skip: int = 0, limit: int = 20, status: int = None, search: str = None) -> list[
        tuple[JobPosition, SysDept | None]]:
        """获取岗位列表（员工端，含部门名称和编码）"""
        query = (
            select(JobPosition, SysDept)
            .outerjoin(SysDept, (SysDept.id == JobPosition.dept_id) & (SysDept.is_deleted == 0))
            .where(JobPosition.is_deleted == 0)
        )
        if status is not None:
            query = query.where(JobPosition.status == status)
        if search:
            query = query.where(JobPosition.name.ilike(f"%{search}%"))
        query = query.order_by(JobPosition.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.all()

    async def count_active(self) -> int:
        """获取在招岗位数"""
        return await self.get_count(status=1)

    async def get_count(self, status: int = None, search: str = None) -> int:
        """获取岗位总数，status=None 时不过滤状态"""
        from sqlalchemy import func
        query = select(func.count(JobPosition.id)).where(JobPosition.is_deleted == 0)
        if status is not None:
            query = query.where(JobPosition.status == status)
        if search:
            query = query.where(JobPosition.name.ilike(f"%{search}%"))
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

    async def create(
        self,
        employee_id: int,
        dept_id: int,
        name: str,
        description: str,
        template_id: int = None,
    ) -> JobPosition:
        job = JobPosition(
            employee_id=employee_id,
            dept_id=dept_id,
            template_id=template_id,
            name=name,
            description=description,
            status=2,
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

    async def count_applications(self, job_id: int) -> int:
        result = await self.db.execute(
            select(func.count(JobApplication.id)).where(
                JobApplication.job_id == job_id,
                JobApplication.is_deleted == 0,
            )
        )
        return result.scalar() or 0

    async def batch_count_applications(self, job_ids: list[int]) -> dict[int, int]:
        if not job_ids:
            return {}
        rows = await self.db.execute(
            select(JobApplication.job_id, func.count(JobApplication.id))
            .where(JobApplication.job_id.in_(job_ids), JobApplication.is_deleted == 0)
            .group_by(JobApplication.job_id)
        )
        return {row[0]: row[1] for row in rows.all()}

    async def get_skills_by_job_ids(self, job_ids: list[int], limit: int = 5) -> dict[int, list[str]]:
        if not job_ids:
            return {}
        result = await self.db.execute(
            select(JobPosition.id, EvalTemplateSkill.skill_name)
            .join(EvalTemplateSkill, EvalTemplateSkill.template_id == JobPosition.template_id)
            .where(JobPosition.id.in_(job_ids), JobPosition.is_deleted == 0)
            .order_by(JobPosition.id.asc(), EvalTemplateSkill.skill_type.asc(), EvalTemplateSkill.id.asc())
        )
        skills_map: dict[int, list[str]] = {job_id: [] for job_id in job_ids}
        for job_id, skill_name in result.all():
            if len(skills_map[job_id]) < limit:
                skills_map[job_id].append(skill_name)
        return skills_map

    async def get_by_ids_batch(self, job_ids: list[int]) -> dict[int, JobPosition]:
        """批量获取岗位: job_id -> JobPosition"""
        if not job_ids:
            return {}
        result = await self.db.execute(
            select(JobPosition).where(
                JobPosition.id.in_(job_ids),
                JobPosition.is_deleted == 0,
            )
        )
        return {job.id: job for job in result.scalars().all()}

    async def delete(self, job_id: int) -> bool:
        await self.db.execute(
            update(JobPosition).where(JobPosition.id == job_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True
