from sqlalchemy import func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.job_position import JobPosition
from app.models.job_skill import JobSkill
from app.models.job_eval_dimension import JobEvalDimension
from app.models.job_position_tag import JobPositionTag
from app.models.job_application import JobApplication
from app.models.sys_tag import SysTag
from app.models.sys_dept import SysDept
from app.utils.ai.prompts import DIMENSION_EVAL_PROMPT


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

    async def create(self, employee_id: int, dept_id: int, name: str, description: str) -> JobPosition:
        job = JobPosition(
            employee_id=employee_id,
            dept_id=dept_id,
            name=name,
            description=description,
            status=2,
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def create_with_details(
            self,
            employee_id: int,
            dept_id: int,
            name: str,
            description: str,
            dimensions: list[dict],
            skills: list[dict],
            tag_ids: list[int]
    ) -> JobPosition:
        """原子创建岗位及其维度、技能、标签"""
        job = JobPosition(employee_id=employee_id, dept_id=dept_id, name=name, description=description, status=2)
        self.db.add(job)
        await self.db.flush()  # 获取 job.id，不提交事务

        for idx, dim in enumerate(dimensions):
            template = dim.get("prompt_template") or DIMENSION_EVAL_PROMPT
            self.db.add(JobEvalDimension(
                job_id=job.id,
                dimension_name=dim["dimension_name"],
                weight=dim["weight"],
                prompt_template=template,
                sort_order=dim.get("sort_order", idx),
            ))

        for skill in skills:
            self.db.add(JobSkill(
                job_id=job.id,
                skill_name=skill["skill_name"],
                skill_type=skill["skill_type"],
                match_label=skill.get("match_label"),
                is_ai_generated=0,
            ))

        for tag_id in tag_ids:
            self.db.add(JobPositionTag(job_id=job.id, tag_id=tag_id))

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

    # ── Dimension CRUD ──────────────────────────────────────────────────────────

    async def get_dimensions(self, job_id: int) -> list[JobEvalDimension]:
        result = await self.db.execute(
            select(JobEvalDimension)
            .where(JobEvalDimension.job_id == job_id)
            .order_by(JobEvalDimension.sort_order.asc())
        )
        return result.scalars().all()

    async def add_dimension(self, job_id: int, dimension_name: str, weight: float,
                            prompt_template: str, sort_order: int = 0) -> JobEvalDimension:
        template = prompt_template or DIMENSION_EVAL_PROMPT
        dim = JobEvalDimension(
            job_id=job_id,
            dimension_name=dimension_name,
            weight=weight,
            prompt_template=template,
            sort_order=sort_order,
        )
        self.db.add(dim)
        await self.db.commit()
        await self.db.refresh(dim)
        return dim

    async def update_dimension(self, dim_id: int, **kwargs) -> JobEvalDimension:
        if "prompt_template" in kwargs and not kwargs["prompt_template"]:
            kwargs["prompt_template"] = DIMENSION_EVAL_PROMPT
        await self.db.execute(
            update(JobEvalDimension).where(JobEvalDimension.id == dim_id).values(**kwargs)
        )
        await self.db.commit()
        result = await self.db.execute(
            select(JobEvalDimension).where(JobEvalDimension.id == dim_id)
        )
        return result.scalar_one()

    async def delete_dimension(self, dim_id: int) -> bool:
        await self.db.execute(
            delete(JobEvalDimension).where(JobEvalDimension.id == dim_id)
        )
        await self.db.commit()
        return True

    # ── Skill CRUD ──────────────────────────────────────────────────────────────

    async def get_job_skills(self, job_id: int) -> list[JobSkill]:
        result = await self.db.execute(
            select(JobSkill)
            .where(JobSkill.job_id == job_id)
            .order_by(JobSkill.skill_type.asc())
        )
        return result.scalars().all()

    async def add_skill(self, job_id: int, skill_name: str, skill_type: int,
                        match_label: str = None) -> JobSkill:
        skill = JobSkill(
            job_id=job_id,
            skill_name=skill_name,
            skill_type=skill_type,
            match_label=match_label,
            is_ai_generated=0,
        )
        self.db.add(skill)
        await self.db.commit()
        await self.db.refresh(skill)
        return skill

    async def delete_skill(self, skill_id: int) -> bool:
        await self.db.execute(delete(JobSkill).where(JobSkill.id == skill_id))
        await self.db.commit()
        return True

    # ── Tag CRUD ────────────────────────────────────────────────────────────────

    async def get_job_tags(self, job_id: int) -> list[SysTag]:
        result = await self.db.execute(
            select(SysTag)
            .join(JobPositionTag, JobPositionTag.tag_id == SysTag.id)
            .where(JobPositionTag.job_id == job_id, SysTag.is_deleted == 0)
            .order_by(SysTag.sort_order.asc())
        )
        return result.scalars().all()

    async def set_job_tags(self, job_id: int, tag_ids: list[int]) -> None:
        await self.db.execute(
            delete(JobPositionTag).where(JobPositionTag.job_id == job_id)
        )
        for tag_id in tag_ids:
            self.db.add(JobPositionTag(job_id=job_id, tag_id=tag_id))
        await self.db.commit()
