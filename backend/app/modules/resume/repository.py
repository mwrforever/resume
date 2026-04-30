from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.resume import Resume
from app.models.sys_user import SysUser
from app.common.sql_utils import safe_ilike


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

    async def list_all(self, skip: int = 0, limit: int = 20, search: str = None) -> tuple[list[tuple[Resume, SysUser | None]], int]:
        """获取所有简历（员工端，含上传者姓名，支持按文件名/上传者姓名搜索）"""
        from sqlalchemy import func, or_

        base_q = select(Resume, SysUser).outerjoin(
            SysUser, (SysUser.id == Resume.user_id) & (SysUser.is_deleted == 0)
        ).where(Resume.is_deleted == 0)
        count_q = select(func.count(Resume.id)).where(Resume.is_deleted == 0)

        if search:
            base_q = base_q.where(
                or_(safe_ilike(Resume.file_name, search), safe_ilike(SysUser.real_name, search))
            )
            count_q = count_q.outerjoin(
                SysUser, (SysUser.id == Resume.user_id) & (SysUser.is_deleted == 0)
            ).where(
                or_(safe_ilike(Resume.file_name, search), safe_ilike(SysUser.real_name, search))
            )

        items_result = await self.db.execute(
            base_q.order_by(Resume.create_time.desc()).offset(skip).limit(limit)
        )
        count_result = await self.db.execute(count_q)
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
