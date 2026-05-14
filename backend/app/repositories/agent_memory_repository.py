from datetime import datetime
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_memory import AgentMemory


class AgentMemoryRepository:
    """Agent 长期记忆的数据访问层，负责 preference 等记忆类型的查询与 upsert。

    仅与 agent_memory 表交互，不涉及业务语义解析。
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _memory_update_values(
        self,
        content: str,
        importance_score: Decimal,
        confidence_score: Decimal,
        source_session_id: int | None,
    ) -> dict[str, Any]:
        """构建记忆更新/插入时通用的字段字典，消除重复 values 拼装。"""
        return {
            "content": content,
            "importance_score": importance_score,
            "confidence_score": confidence_score,
            "source_session_id": source_session_id,
            "last_access_time": datetime.now(),
        }

    async def list_memories(self, employee_id: int, limit: int = 20, touch_access_time: bool = False) -> list[AgentMemory]:
        """按时间倒序查询员工的长期记忆列表，可选更新访问时间。

        Args:
            employee_id: 员工 ID
            limit: 返回条数上限，默认 20
            touch_access_time: 是否批量更新 last_access_time

        Returns:
            list[AgentMemory]: 记忆实体列表
        """

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
            await self.db.flush()
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
        """根据唯一键 (employee_id, memory_type, memory_key) 更新或插入一条记忆。

        若并发冲突导致插入失败，自动回滚并执行更新，保证幂等性。

        Args:
            employee_id: 员工 ID
            memory_type: 记忆类型，如 preference
            memory_key: 记忆唯一键（通常由内容哈希生成）
            content: 记忆文本内容
            importance_score: 重要度评分
            confidence_score: 置信度评分
            source_session_id: 来源会话 ID，可选

        Returns:
            AgentMemory: 最终落库的记忆实体
        """
        result = await self.db.execute(
            select(AgentMemory).where(
                AgentMemory.employee_id == employee_id,
                AgentMemory.memory_type == memory_type,
                AgentMemory.memory_key == memory_key,
            )
        )
        existing = result.scalar_one_or_none()
        update_values = self._memory_update_values(content, importance_score, confidence_score, source_session_id)
        if existing:
            await self.db.execute(update(AgentMemory).where(AgentMemory.id == existing.id).values(**update_values))
            await self.db.flush()
            result = await self.db.execute(select(AgentMemory).where(AgentMemory.id == existing.id))
            return result.scalar_one()

        memory = AgentMemory(
            employee_id=employee_id,
            memory_type=memory_type,
            memory_key=memory_key,
            **update_values,
        )
        self.db.add(memory)
        try:
            await self.db.flush()
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
                .values(**update_values)
            )
            await self.db.flush()
            result = await self.db.execute(select(AgentMemory).where(AgentMemory.id == existing_memory.id))
            return result.scalar_one()
        await self.db.refresh(memory)
        return memory
