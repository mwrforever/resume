from sqlalchemy import select, update
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
