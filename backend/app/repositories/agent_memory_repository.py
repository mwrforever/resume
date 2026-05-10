from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_context_snapshot import AgentContextSnapshot
from app.models.agent_memory import AgentMemory

SNAPSHOT_CREATE_MAX_RETRY = 3


class AgentMemoryRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_memories(self, employee_id: int, limit: int = 20, touch_access_time: bool = False) -> list[AgentMemory]:
        result = await self.db.execute(
            select(AgentMemory)
            .where(AgentMemory.employee_id == employee_id)
            .order_by(AgentMemory.create_time.desc(), AgentMemory.id.desc())
            .limit(limit)
        )
        memories = result.scalars().all()
        if memories and touch_access_time:
            memory_ids = [memory.id for memory in memories]
            await self.db.execute(update(AgentMemory).where(AgentMemory.id.in_(memory_ids)).values(last_access_time=datetime.now()))
            await self.db.commit()
        return memories

    async def upsert_memory(
        self,
        employee_id: int,
        memory_type: str,
        memory_key: str,
        content: str,
        importance_score: Decimal,
        confidence_score: Decimal,
        source_session_id: int | None,
    ) -> AgentMemory:
        result = await self.db.execute(
            select(AgentMemory).where(
                AgentMemory.employee_id == employee_id,
                AgentMemory.memory_type == memory_type,
                AgentMemory.memory_key == memory_key,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            await self.db.execute(
                update(AgentMemory)
                .where(AgentMemory.id == existing.id)
                .values(
                    content=content,
                    importance_score=importance_score,
                    confidence_score=confidence_score,
                    source_session_id=source_session_id,
                    last_access_time=datetime.now(),
                )
            )
            await self.db.commit()
            result = await self.db.execute(select(AgentMemory).where(AgentMemory.id == existing.id))
            return result.scalar_one()
        memory = AgentMemory(
            employee_id=employee_id,
            memory_type=memory_type,
            memory_key=memory_key,
            content=content,
            importance_score=importance_score,
            confidence_score=confidence_score,
            source_session_id=source_session_id,
            last_access_time=datetime.now(),
        )
        self.db.add(memory)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            result = await self.db.execute(
                select(AgentMemory).where(
                    AgentMemory.employee_id == employee_id,
                    AgentMemory.memory_type == memory_type,
                    AgentMemory.memory_key == memory_key,
                )
            )
            existing_memory = result.scalar_one()
            await self.db.execute(
                update(AgentMemory)
                .where(AgentMemory.id == existing_memory.id)
                .values(
                    content=content,
                    importance_score=importance_score,
                    confidence_score=confidence_score,
                    source_session_id=source_session_id,
                    last_access_time=datetime.now(),
                )
            )
            await self.db.commit()
            result = await self.db.execute(select(AgentMemory).where(AgentMemory.id == existing_memory.id))
            return result.scalar_one()
        await self.db.refresh(memory)
        return memory

    async def latest_snapshot(self, session_id: int) -> AgentContextSnapshot | None:
        result = await self.db.execute(
            select(AgentContextSnapshot)
            .where(AgentContextSnapshot.session_id == session_id)
            .order_by(AgentContextSnapshot.snapshot_version.desc(), AgentContextSnapshot.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_snapshots(self, session_id: int, limit: int = 20) -> list[AgentContextSnapshot]:
        result = await self.db.execute(
            select(AgentContextSnapshot)
            .where(AgentContextSnapshot.session_id == session_id)
            .order_by(AgentContextSnapshot.snapshot_version.desc(), AgentContextSnapshot.id.desc())
            .limit(limit)
        )
        return result.scalars().all()

    async def next_snapshot_version(self, session_id: int) -> int:
        result = await self.db.execute(
            select(func.max(AgentContextSnapshot.snapshot_version)).where(AgentContextSnapshot.session_id == session_id)
        )
        return (result.scalar() or 0) + 1

    async def create_snapshot(
        self,
        session_id: int,
        snapshot_version: int,
        summary_text: str,
        covered_message_start_id: int,
        covered_message_end_id: int,
        message_count: int,
        token_count: int,
        model_name: str | None,
    ) -> AgentContextSnapshot:
        current_version = snapshot_version
        for retry_index in range(SNAPSHOT_CREATE_MAX_RETRY):
            snapshot = AgentContextSnapshot(
                session_id=session_id,
                snapshot_version=current_version,
                summary_text=summary_text,
                covered_message_start_id=covered_message_start_id,
                covered_message_end_id=covered_message_end_id,
                message_count=message_count,
                token_count=token_count,
                model_name=model_name,
            )
            self.db.add(snapshot)
            try:
                await self.db.commit()
                await self.db.refresh(snapshot)
                return snapshot
            except IntegrityError:
                await self.db.rollback()
                if retry_index == SNAPSHOT_CREATE_MAX_RETRY - 1:
                    raise
                current_version = await self.next_snapshot_version(session_id)
