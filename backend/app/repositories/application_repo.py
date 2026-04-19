from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.job_application import JobApplication


class ApplicationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

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