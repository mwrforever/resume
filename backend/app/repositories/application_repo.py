from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.job_application import JobApplication


class ApplicationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_user_and_job(self, user_id: int, job_id: int) -> JobApplication:
        result = await self.db.execute(
            select(JobApplication).where(
                JobApplication.user_id == user_id,
                JobApplication.job_id == job_id,
                JobApplication.is_deleted == 0
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, app_id: int) -> JobApplication:
        result = await self.db.execute(
            select(JobApplication).where(JobApplication.id == app_id, JobApplication.is_deleted == 0)
        )
        return result.scalar_one_or_none()

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

    async def create(self, user_id: int, job_id: int, resume_id: int) -> JobApplication:
        app = JobApplication(user_id=user_id, job_id=job_id, resume_id=resume_id)
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

    async def get_all(self, skip: int = 0, limit: int = 20, status: int = None) -> list[JobApplication]:
        """获取所有投递记录（员工端），可按状态过滤"""
        query = select(JobApplication).where(JobApplication.is_deleted == 0)
        if status is not None:
            query = query.where(JobApplication.status == status)
        query = query.order_by(JobApplication.create_time.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_all_count(self, status: int = None) -> int:
        """获取所有投递记录总数（员工端），可按状态过滤"""
        query = select(func.count(JobApplication.id)).where(JobApplication.is_deleted == 0)
        if status is not None:
            query = query.where(JobApplication.status == status)
        result = await self.db.execute(query)
        return result.scalar() or 0