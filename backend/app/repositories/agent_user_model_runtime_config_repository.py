from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_user_model_runtime_config import AgentUserModelRuntimeConfig


class AgentUserModelRuntimeConfigRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_employee_llm_config(self, employee_id: int, llm_config_id: int) -> AgentUserModelRuntimeConfig | None:
        result = await self.db.execute(
            select(AgentUserModelRuntimeConfig).where(
                AgentUserModelRuntimeConfig.employee_id == employee_id,
                AgentUserModelRuntimeConfig.llm_config_id == llm_config_id,
            )
        )
        return result.scalar_one_or_none()

    async def create(self, **kwargs: Any) -> AgentUserModelRuntimeConfig:
        item = AgentUserModelRuntimeConfig(**kwargs)
        self.db.add(item)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise
        await self.db.refresh(item)
        return item

    async def update(self, config_id: int, **kwargs: Any) -> AgentUserModelRuntimeConfig | None:
        try:
            await self.db.execute(update(AgentUserModelRuntimeConfig).where(AgentUserModelRuntimeConfig.id == config_id).values(**kwargs))
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise
        result = await self.db.execute(select(AgentUserModelRuntimeConfig).where(AgentUserModelRuntimeConfig.id == config_id))
        return result.scalar_one_or_none()

    async def touch_last_used(self, config_id: int) -> AgentUserModelRuntimeConfig | None:
        return await self.update(config_id, last_used_at=datetime.now())
