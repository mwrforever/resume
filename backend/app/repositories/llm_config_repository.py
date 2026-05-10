from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm_model_config import LlmModelConfig


class LlmConfigRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, config_id: int) -> LlmModelConfig | None:
        result = await self.db.execute(select(LlmModelConfig).where(LlmModelConfig.id == config_id))
        return result.scalar_one_or_none()

    async def get_by_biz_model(self, biz_type: str, biz_id: int, model_name: str) -> LlmModelConfig | None:
        result = await self.db.execute(
            select(LlmModelConfig).where(
                LlmModelConfig.biz_type == biz_type,
                LlmModelConfig.biz_id == biz_id,
                LlmModelConfig.model_name == model_name,
            )
        )
        return result.scalar_one_or_none()

    async def list_by_biz(self, biz_type: str, biz_id: int) -> list[LlmModelConfig]:
        result = await self.db.execute(
            select(LlmModelConfig)
            .where(LlmModelConfig.biz_type == biz_type, LlmModelConfig.biz_id == biz_id)
            .order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc())
        )
        return result.scalars().all()

    async def list_employee_available(self, employee_id: int, dept_ids: list[int]) -> list[LlmModelConfig]:
        conditions = [(LlmModelConfig.biz_type == "employee") & (LlmModelConfig.biz_id == employee_id)]
        if dept_ids:
            conditions.append((LlmModelConfig.biz_type == "dept") & (LlmModelConfig.biz_id.in_(dept_ids)))
        result = await self.db.execute(
            select(LlmModelConfig)
            .where(LlmModelConfig.status == 1, or_(*conditions))
            .order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc())
        )
        return result.scalars().all()

    async def create(self, **kwargs) -> LlmModelConfig:
        config = LlmModelConfig(**kwargs)
        self.db.add(config)
        await self.db.commit()
        await self.db.refresh(config)
        return config

    async def update(self, config_id: int, **kwargs) -> LlmModelConfig | None:
        await self.db.execute(update(LlmModelConfig).where(LlmModelConfig.id == config_id).values(**kwargs))
        await self.db.commit()
        return await self.get_by_id(config_id)

    async def delete(self, config_id: int) -> None:
        config = await self.get_by_id(config_id)
        if config:
            await self.db.delete(config)
            await self.db.commit()
