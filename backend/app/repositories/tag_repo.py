from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.sys_tag import SysTag


class TagRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_tags(self, tag_type: int = None) -> list[SysTag]:
        query = select(SysTag).where(SysTag.is_deleted == 0, SysTag.status == 1)
        if tag_type is not None:
            query = query.where(SysTag.tag_type == tag_type)
        query = query.order_by(SysTag.sort_order.asc(), SysTag.id.asc())
        result = await self.db.execute(query)
        return result.scalars().all()
