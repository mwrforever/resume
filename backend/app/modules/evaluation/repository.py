from datetime import datetime
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.job_application import JobApplication
from app.models.resume import Resume
from app.models.resume_eval_detail import ResumeEvalDetail
from app.models.resume_job_match import ResumeJobMatch
from app.models.resume_skill_hit import ResumeSkillHit
from sqlalchemy import select, update
from app.models.sys_user import SysUser
from sqlalchemy import func, select, update
from app.models.eval_template_skill import EvalTemplateSkill
from app.models.job_position import JobPosition
from app.models.sys_dept import SysDept
from sqlalchemy import select, update, func


class EvalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_match(self, application_id: int, resume_id: int, job_id: int) -> ResumeJobMatch:
        match = ResumeJobMatch(application_id=application_id, resume_id=resume_id, job_id=job_id)
        self.db.add(match)
        await self.db.commit()
        await self.db.refresh(match)
        return match

    async def get_match_by_id(self, match_id: int) -> ResumeJobMatch:
        result = await self.db.execute(select(ResumeJobMatch).where(ResumeJobMatch.id == match_id))
        return result.scalar_one_or_none()

    async def get_match_by_application_id(self, application_id: int) -> ResumeJobMatch:
        result = await self.db.execute(
            select(ResumeJobMatch).where(ResumeJobMatch.application_id == application_id)
        )
        return result.scalar_one_or_none()

    async def update_match_result(self, match_id: int, score: float, label: str, advantage: str, disadvantage: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(
                final_score=score,
                final_label=label,
                advantage_comment=advantage,
                disadvantage_comment=disadvantage,
                evaluated_at=datetime.now(),
                error_message=None,
            )
        )
        await self.db.commit()
        return True

    async def update_match_error(self, match_id: int, error_message: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(error_message=error_message)
        )
        await self.db.commit()
        return True

    async def create_eval_detail(self, match_id: int, dimension_id: int, score: float, advantage: str, disadvantage: str) -> ResumeEvalDetail:
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage,
        )
        self.db.add(detail)
        await self.db.commit()
        await self.db.refresh(detail)
        return detail

    async def create_eval_detail_with_status(
        self,
        match_id: int,
        dimension_id: int,
        score: float,
        advantage: str,
        disadvantage: str,
        is_completed: bool = True,
        error_message: str = None,
    ) -> ResumeEvalDetail:
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage,
            is_completed=1 if is_completed else 0,
            error_message=error_message,
        )
        self.db.add(detail)
        await self.db.commit()
        await self.db.refresh(detail)
        return detail

    async def get_eval_details(self, match_id: int) -> list[ResumeEvalDetail]:
        result = await self.db.execute(
            select(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id)
        )
        return result.scalars().all()

    async def delete_eval_details_by_match(self, match_id: int) -> None:
        await self.db.execute(delete(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id))
        await self.db.commit()

    async def create_skill_hit(self, match_id: int, skill_id: int, is_hit: int, hit_context: str) -> ResumeSkillHit:
        hit = ResumeSkillHit(
            match_id=match_id,
            skill_id=skill_id,
            is_hit=is_hit,
            hit_context=hit_context,
        )
        self.db.add(hit)
        await self.db.commit()
        await self.db.refresh(hit)
        return hit

    async def get_skill_hits(self, match_id: int) -> list[ResumeSkillHit]:
        result = await self.db.execute(
            select(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id)
        )
        return result.scalars().all()

    async def delete_skill_hits_by_match(self, match_id: int) -> None:
        await self.db.execute(delete(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id))
        await self.db.commit()

    async def get_match_distribution(self, job_id: int) -> dict:
        result = await self.db.execute(
            select(
                func.count().label("total"),
                func.sum(case((ResumeJobMatch.final_label == "优秀", 1), else_=0)).label("excellent"),
                func.sum(case((ResumeJobMatch.final_label == "良好", 1), else_=0)).label("good"),
                func.sum(case((ResumeJobMatch.final_label == "一般", 1), else_=0)).label("average"),
                func.sum(case((ResumeJobMatch.final_label == "未达标", 1), else_=0)).label("fail"),
            ).where(ResumeJobMatch.job_id == job_id)
        )
        row = result.one()
        total = row.total or 0
        return {
            "total": total,
            "excellent": {"count": row.excellent or 0, "percentage": round((row.excellent or 0) / total * 100, 1) if total else 0},
            "good": {"count": row.good or 0, "percentage": round((row.good or 0) / total * 100, 1) if total else 0},
            "average": {"count": row.average or 0, "percentage": round((row.average or 0) / total * 100, 1) if total else 0},
            "fail": {"count": row.fail or 0, "percentage": round((row.fail or 0) / total * 100, 1) if total else 0},
        }

    async def count_pending_evaluations(self) -> int:
        matched_subq = select(ResumeJobMatch.application_id).distinct()
        result = await self.db.execute(
            select(func.count(JobApplication.id)).where(
                JobApplication.is_deleted == 0,
                JobApplication.status == 0,
                ~JobApplication.id.in_(matched_subq),
            )
        )
        return result.scalar() or 0

    async def get_applications_by_job(self, job_id: int, offset: int = 0, limit: int = 20) -> tuple[list[dict], int]:
        result = await self.db.execute(
            select(
                JobApplication.id.label("application_id"),
                JobApplication.resume_id,
                Resume.file_name,
                ResumeJobMatch.id.label("match_id"),
                ResumeJobMatch.final_score,
                ResumeJobMatch.final_label,
                ResumeJobMatch.error_message,
            )
            .join(Resume, Resume.id == JobApplication.resume_id)
            .outerjoin(ResumeJobMatch, ResumeJobMatch.application_id == JobApplication.id)
            .where(JobApplication.job_id == job_id, JobApplication.is_deleted == 0)
            .order_by(ResumeJobMatch.final_score.desc(), JobApplication.id.desc())
            .offset(offset)
            .limit(limit)
        )
        items = [
            {
                "application_id": row.application_id,
                "resume_id": row.resume_id,
                "file_name": row.file_name,
                "match_id": row.match_id,
                "final_score": float(row.final_score) if row.final_score is not None else None,
                "final_label": row.final_label or "待评估",
                "status": "failed" if row.error_message else ("completed" if row.match_id else "pending"),
            }
            for row in result.all()
        ]
        count_result = await self.db.execute(
            select(func.count(JobApplication.id)).where(
                JobApplication.job_id == job_id,
                JobApplication.is_deleted == 0,
            )
        )
        return items, count_result.scalar() or 0

    async def get_matches_by_application_ids(self, application_ids: list[int]) -> dict[int, int]:
        if not application_ids:
            return {}
        result = await self.db.execute(
            select(ResumeJobMatch.id, ResumeJobMatch.application_id)
            .where(ResumeJobMatch.application_id.in_(application_ids))
        )
        return {row.application_id: row.id for row in result.all()}

    async def get_avg_match_score(self) -> float:
        result = await self.db.execute(
            select(func.avg(ResumeJobMatch.final_score)).where(ResumeJobMatch.final_score.isnot(None))
        )
        return result.scalar() or 0.0


class ResumeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, resume_id: int) -> Resume | None:
        result = await self.db.execute(
            select(Resume).where(Resume.id == resume_id, Resume.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: int) -> list[Resume]:
        result = await self.db.execute(
            select(Resume).where(Resume.user_id == user_id, Resume.is_deleted == 0)
            .order_by(Resume.create_time.desc())
        )
        return list(result.scalars().all())

    async def create(self, user_id: int, file_name: str, file_path: str, storage_type: str, raw_text: str = "") -> Resume:
        resume = Resume(
            user_id=user_id,
            file_name=file_name,
            file_path=file_path,
            storage_type=storage_type,
            raw_text=raw_text
        )
        self.db.add(resume)
        await self.db.commit()
        await self.db.refresh(resume)
        return resume

    async def update_raw_text(self, resume_id: int, raw_text: str) -> bool:
        await self.db.execute(
            update(Resume).where(Resume.id == resume_id).values(raw_text=raw_text)
        )
        await self.db.commit()
        return True

    async def update_status(self, resume_id: int, status: int) -> bool:
        await self.db.execute(
            update(Resume).where(Resume.id == resume_id).values(status=status)
        )
        await self.db.commit()
        return True

    async def delete(self, resume_id: int) -> bool:
        await self.db.execute(
            update(Resume).where(Resume.id == resume_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True

    async def count_all(self) -> int:
        """获取简历总数"""
        from sqlalchemy import func
        result = await self.db.execute(
            select(func.count(Resume.id)).where(Resume.is_deleted == 0)
        )
        return result.scalar() or 0

    async def list_all(self, skip: int = 0, limit: int = 20) -> tuple[list[tuple[Resume, SysUser | None]], int]:
        """获取所有简历（员工端，含上传者姓名）"""
        from sqlalchemy import func
        items_result = await self.db.execute(
            select(Resume, SysUser)
            .outerjoin(SysUser, (SysUser.id == Resume.user_id) & (SysUser.is_deleted == 0))
            .where(Resume.is_deleted == 0)
            .order_by(Resume.create_time.desc())
            .offset(skip).limit(limit)
        )
        count_result = await self.db.execute(
            select(func.count(Resume.id)).where(Resume.is_deleted == 0)
        )
        return items_result.all(), count_result.scalar() or 0

    async def get_file_names_batch(self, resume_ids: list[int]) -> dict[int, str]:
        """批量获取简历文件名: resume_id -> file_name"""
        if not resume_ids:
            return {}
        result = await self.db.execute(
            select(Resume.id, Resume.file_name)
            .where(Resume.id.in_(resume_ids), Resume.is_deleted == 0)
        )
        return {row.id: row.file_name for row in result.all()}

    async def list_pending(self) -> list[Resume]:
        """获取异常简历（status=1, 员工端）"""
        result = await self.db.execute(
            select(Resume)
            .where(Resume.is_deleted == 0, Resume.status == 1)
            .order_by(Resume.create_time.desc())
        )
        return result.scalars().all()


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

    async def delete(self, job_id: int) -> bool:
        await self.db.execute(
            update(JobPosition).where(JobPosition.id == job_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True


class ApplicationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_user_and_job(self, user_id: int, job_id: int) -> JobApplication:
        result = await self.db.execute(
            select(JobApplication).where(
                JobApplication.user_id == user_id,
                JobApplication.job_id == job_id,
                JobApplication.is_deleted == 0,
                JobApplication.status != 6,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, app_id: int) -> JobApplication:
        result = await self.db.execute(
            select(JobApplication).where(JobApplication.id == app_id, JobApplication.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_existing_ids(self, app_ids: list[int]) -> set[int]:
        if not app_ids:
            return set()
        result = await self.db.execute(
            select(JobApplication.id).where(
                JobApplication.id.in_(app_ids),
                JobApplication.is_deleted == 0,
            )
        )
        return {int(row[0]) for row in result.all()}

    async def get_by_user(self, user_id: int, skip: int = 0, limit: int = 20) -> list[JobApplication]:
        result = await self.db.execute(
            select(JobApplication)
            .where(JobApplication.user_id == user_id, JobApplication.is_deleted == 0)
            .offset(skip).limit(limit)
            .order_by(JobApplication.create_time.desc())
        )
        return result.scalars().all()

    async def get_by_user_count(self, user_id: int) -> int:
        result = await self.db.execute(
            select(func.count(JobApplication.id))
            .where(JobApplication.user_id == user_id, JobApplication.is_deleted == 0)
        )
        return result.scalar() or 0

    async def get_by_job(self, job_id: int, skip: int = 0, limit: int = 20) -> list[JobApplication]:
        result = await self.db.execute(
            select(JobApplication)
            .where(JobApplication.job_id == job_id, JobApplication.is_deleted == 0)
            .offset(skip).limit(limit)
            .order_by(JobApplication.create_time.desc())
        )
        return result.scalars().all()

    async def get_by_job_count(self, job_id: int) -> int:
        result = await self.db.execute(
            select(func.count(JobApplication.id))
            .where(JobApplication.job_id == job_id, JobApplication.is_deleted == 0)
        )
        return result.scalar() or 0

    async def create(self, user_id: int, job_id: int, resume_id: int, job_snapshot: dict) -> JobApplication:
        app = JobApplication(user_id=user_id, job_id=job_id, resume_id=resume_id, job_snapshot=job_snapshot)
        self.db.add(app)
        await self.db.commit()
        await self.db.refresh(app)
        return app

    async def update_status(self, app_id: int, status: int) -> bool:
        await self.db.execute(
            update(JobApplication).where(JobApplication.id == app_id).values(status=status)
        )
        await self.db.commit()
        return True

    async def soft_delete(self, app_id: int) -> bool:
        """撤回投递（软删除）"""
        await self.db.execute(
            update(JobApplication).where(JobApplication.id == app_id).values(is_deleted=1)
        )
        await self.db.commit()
        return True

    async def get_all(self, skip: int = 0, limit: int = 20, status: int = None, job_ids: list[int] = None, dept_ids: list[int] = None) -> list[JobApplication]:
        """获取所有投递记录（员工端），可按状态过滤"""
        query = select(JobApplication).where(JobApplication.is_deleted == 0)
        if status is not None:
            query = query.where(JobApplication.status == status)
        if job_ids:
            query = query.where(JobApplication.job_id.in_(job_ids))
        if dept_ids:
            query = query.join(JobPosition, JobPosition.id == JobApplication.job_id).where(
                JobPosition.is_deleted == 0,
                JobPosition.dept_id.in_(dept_ids),
            )
        query = query.order_by(JobApplication.create_time.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_all_count(self, status: int = None, job_ids: list[int] = None, dept_ids: list[int] = None) -> int:
        """获取所有投递记录总数（员工端），可按状态过滤"""
        query = select(func.count(JobApplication.id)).where(JobApplication.is_deleted == 0)
        if status is not None:
            query = query.where(JobApplication.status == status)
        if job_ids:
            query = query.where(JobApplication.job_id.in_(job_ids))
        if dept_ids:
            query = query.join(JobPosition, JobPosition.id == JobApplication.job_id).where(
                JobPosition.is_deleted == 0,
                JobPosition.dept_id.in_(dept_ids),
            )
        result = await self.db.execute(query)
        return result.scalar() or 0
