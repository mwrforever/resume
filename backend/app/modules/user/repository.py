from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.sys_user import SysUser


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: int) -> SysUser:
        result = await self.db.execute(
            select(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> SysUser:
        result = await self.db.execute(
            select(SysUser).where(SysUser.email == email, SysUser.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_identifier(self, identifier: str) -> SysUser:
        # identifier can be username or email
        result = await self.db.execute(
            select(SysUser).where(
                (SysUser.email == identifier) | (SysUser.real_name == identifier),
                SysUser.is_deleted == 0
            )
        )
        return result.scalar_one_or_none()

    async def create(self, email: str, password_hash: str, real_name: str) -> SysUser:
        user = SysUser(email=email, password_hash=password_hash, real_name=real_name)
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def get_count(self, status: int = None, search: str = None) -> int:
        query = select(func.count(SysUser.id)).where(SysUser.is_deleted == 0)
        if status is not None:
            query = query.where(SysUser.status == status)
        if search:
            query = query.where((SysUser.email.ilike(f"%{search}%")) | (SysUser.real_name.ilike(f"%{search}%")))
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def list_page(self, skip: int = 0, limit: int = 20, status: int = None, search: str = None) -> list[SysUser]:
        query = select(SysUser).where(SysUser.is_deleted == 0)
        if status is not None:
            query = query.where(SysUser.status == status)
        if search:
            query = query.where((SysUser.email.ilike(f"%{search}%")) | (SysUser.real_name.ilike(f"%{search}%")))
        query = query.order_by(SysUser.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def update(self, user_id: int, **kwargs) -> SysUser:
        await self.db.execute(
            update(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_by_id(user_id)

    async def delete(self, user_id: int) -> bool:
        await self.db.execute(
            update(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0).values(is_deleted=1)
        )
        await self.db.commit()
        return True
