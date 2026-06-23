from datetime import datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm_model_config import LlmModelConfig


class LlmConfigRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, config_id: int, include_deleted: bool = False) -> LlmModelConfig | None:
        query = select(LlmModelConfig).where(LlmModelConfig.id == config_id)
        if not include_deleted:
            query = query.where(LlmModelConfig.is_deleted == 0)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_by_model_name(self, model_name: str) -> LlmModelConfig | None:
        """按 model_name 查询未删除的配置（用于全局唯一性校验）。"""
        query = select(LlmModelConfig).where(
            LlmModelConfig.model_name == model_name,
            LlmModelConfig.is_deleted == 0,
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_available(self) -> list[LlmModelConfig]:
        """查询所有启用中的全局模型配置（供员工选择使用）。"""
        result = await self.db.execute(
            select(LlmModelConfig)
            .where(LlmModelConfig.status == 1, LlmModelConfig.is_deleted == 0)
            .order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc())
        )
        return result.scalars().all()

    def _list_query(self, keyword: str | None = None, status: int | None = None):
        """构造全量列表查询（模型配置已统一为全局，不再按归属过滤）。"""
        query = select(LlmModelConfig).where(LlmModelConfig.is_deleted == 0)
        if keyword:
            like_keyword = f"%{keyword}%"
            query = query.where(
                or_(
                    LlmModelConfig.config_name.like(like_keyword),
                    LlmModelConfig.model_name.like(like_keyword),
                    LlmModelConfig.base_url.like(like_keyword),
                )
            )
        if status is not None:
            query = query.where(LlmModelConfig.status == status)
        return query

    async def count_all(self, keyword: str | None = None, status: int | None = None) -> int:
        """统计可见模型配置总数。"""
        query = self._list_query(keyword, status)
        result = await self.db.execute(query.with_only_columns(func.count(LlmModelConfig.id)).order_by(None))
        return result.scalar() or 0

    async def list_all(
        self, page: int, page_size: int, keyword: str | None = None, status: int | None = None,
    ) -> list[LlmModelConfig]:
        """分页查询全部模型配置。"""
        query = (
            self._list_query(keyword, status)
            .order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        return result.scalars().all()

    async def create(self, **kwargs) -> LlmModelConfig:
        config = LlmModelConfig(**kwargs)
        self.db.add(config)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise
        await self.db.refresh(config)
        return config

    async def update(self, config_id: int, **kwargs) -> LlmModelConfig | None:
        try:
            await self.db.execute(update(LlmModelConfig).where(LlmModelConfig.id == config_id, LlmModelConfig.is_deleted == 0).values(**kwargs))
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise
        return await self.get_by_id(config_id)

    async def soft_delete(self, config_id: int) -> None:
        for retry_index in range(3):
            deleted_timestamp = int(datetime.now().timestamp() * 1_000_000)
            try:
                await self.db.execute(
                    update(LlmModelConfig)
                    .where(LlmModelConfig.id == config_id, LlmModelConfig.is_deleted == 0)
                    .values(is_deleted=deleted_timestamp)
                )
                await self.db.commit()
                return
            except IntegrityError:
                await self.db.rollback()
                if retry_index == 2:
                    raise
