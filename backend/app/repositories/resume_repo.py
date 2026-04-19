from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.resume import Resume


class ResumeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, resume_id: int) -> Resume:
        result = await self.db.execute(
            select(Resume).where(Resume.id == resume_id, Resume.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_user(self, user_id: int) -> list[Resume]:
        result = await self.db.execute(
            select(Resume).where(Resume.user_id == user_id, Resume.is_deleted == 0)
            .order_by(Resume.create_time.desc())
        )
        return result.scalars().all()

    async def create(self, user_id: int, file_name: str, file_path: str, storage_type: str) -> Resume:
        resume = Resume(
            user_id=user_id,
            file_name=file_name,
            file_path=file_path,
            storage_type=storage_type
        )
        self.db.add(resume)
        await self.db.commit()
        await self.db.refresh(resume)
        return resume

    async def update_raw_text(self, resume_id: int, raw_text: str) -> bool:
        await self.db.execute(
            update(Resume).where(Resume.id == resume_id).values(raw_text=raw_text, status=2)
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