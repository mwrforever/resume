from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_workspace_preference import AgentWorkspacePreference


class AgentWorkspacePreferenceRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_employee(self, employee_id: int) -> AgentWorkspacePreference | None:
        result = await self.db.execute(select(AgentWorkspacePreference).where(AgentWorkspacePreference.employee_id == employee_id))
        return result.scalar_one_or_none()

    async def upsert(
        self,
        employee_id: int,
        selected_model_name: str | None,
        selected_model_source: str,
        selected_llm_config_id: int | None,
    ) -> AgentWorkspacePreference:
        current = await self.get_by_employee(employee_id)
        payload = {
            "selected_model_name": selected_model_name,
            "selected_model_source": selected_model_source,
            "selected_llm_config_id": selected_llm_config_id,
            "last_selected_at": datetime.now(),
        }
        try:
            if current:
                await self.db.execute(update(AgentWorkspacePreference).where(AgentWorkspacePreference.id == current.id).values(**payload))
                await self.db.commit()
                updated = await self.get_by_employee(employee_id)
                return updated
            item = AgentWorkspacePreference(employee_id=employee_id, **payload)
            self.db.add(item)
            await self.db.commit()
            await self.db.refresh(item)
            return item
        except IntegrityError:
            await self.db.rollback()
            updated = await self.get_by_employee(employee_id)
            if updated:
                return updated
            raise
