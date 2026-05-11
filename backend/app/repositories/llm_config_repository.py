from datetime import datetime

from sqlalchemy import or_, select, update
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

    async def get_by_biz_model(self, biz_type: str, biz_id: int, model_name: str) -> LlmModelConfig | None:
        query = select(LlmModelConfig).where(
            LlmModelConfig.biz_type == biz_type,
            LlmModelConfig.biz_id == biz_id,
            LlmModelConfig.model_name == model_name,
            LlmModelConfig.is_deleted == 0,
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_by_biz(self, biz_type: str, biz_id: int) -> list[LlmModelConfig]:
        result = await self.db.execute(
            select(LlmModelConfig)
            .where(LlmModelConfig.biz_type == biz_type, LlmModelConfig.biz_id == biz_id, LlmModelConfig.is_deleted == 0)
            .order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc())
        )
        return result.scalars().all()

    async def list_employee_available(self, employee_id: int, dept_ids: list[int]) -> list[LlmModelConfig]:
        conditions = [(LlmModelConfig.biz_type == "employee") & (LlmModelConfig.biz_id == employee_id)]
        if dept_ids:
            conditions.append((LlmModelConfig.biz_type == "dept") & (LlmModelConfig.biz_id.in_(dept_ids)))
        result = await self.db.execute(
            select(LlmModelConfig)
            .where(LlmModelConfig.status == 1, LlmModelConfig.is_deleted == 0, or_(*conditions))
            .order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc())
        )
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
