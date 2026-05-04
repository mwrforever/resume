from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.eval_template_tag import EvalTemplateTag
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

    async def get_by_id(self, tag_id: int) -> SysTag:
        result = await self.db.execute(
            select(SysTag).where(SysTag.id == tag_id, SysTag.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_count(self, tag_type: int = None, status: int = None, search: str = None) -> int:
        query = select(func.count(SysTag.id)).where(SysTag.is_deleted == 0)
        if tag_type is not None:
            query = query.where(SysTag.tag_type == tag_type)
        if status is not None:
            query = query.where(SysTag.status == status)
        if search:
            query = query.where(SysTag.tag_name.ilike(f"%{search}%"))
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def list_page(
        self,
        skip: int = 0,
        limit: int = 20,
        tag_type: int = None,
        status: int = None,
        search: str = None,
    ) -> list[SysTag]:
        query = select(SysTag).where(SysTag.is_deleted == 0)
        if tag_type is not None:
            query = query.where(SysTag.tag_type == tag_type)
        if status is not None:
            query = query.where(SysTag.status == status)
        if search:
            query = query.where(SysTag.tag_name.ilike(f"%{search}%"))
        query = query.order_by(SysTag.sort_order.asc(), SysTag.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def create(self, tag_name: str, tag_type: int, sort_order: int, status: int, color: str) -> SysTag:
        tag = SysTag(
            tag_name=tag_name,
            tag_type=tag_type,
            sort_order=sort_order,
            status=status,
            color=color,
        )
        self.db.add(tag)
        await self.db.commit()
        await self.db.refresh(tag)
        return tag

    async def update(self, tag_id: int, **kwargs) -> SysTag:
        await self.db.execute(
            update(SysTag).where(SysTag.id == tag_id, SysTag.is_deleted == 0).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_by_id(tag_id)

    async def delete(self, tag_id: int) -> bool:
        await self.db.execute(
            update(SysTag).where(SysTag.id == tag_id, SysTag.is_deleted == 0).values(is_deleted=1)
        )
        await self.db.commit()
        return True

    async def count_job_associations(self, tag_id: int) -> int:
        result = await self.db.execute(
            select(func.count(EvalTemplateTag.id)).where(EvalTemplateTag.tag_id == tag_id)
        )
        return result.scalar() or 0

    async def batch_count_job_associations(self, tag_ids: list[int]) -> dict[int, int]:
        if not tag_ids:
            return {}
        rows = await self.db.execute(
            select(EvalTemplateTag.tag_id, func.count(EvalTemplateTag.tag_id))
            .where(EvalTemplateTag.tag_id.in_(tag_ids))
            .group_by(EvalTemplateTag.tag_id)
        )
        return {row[0]: row[1] for row in rows.all()}
