"""Agent 会话与消息数据访问层。

仅操作 agent_session 和 agent_message 表，
不涉及 agent_memory（已删除）。
"""

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_message import AgentMessage
from app.models.agent_session import AgentSession


class AgentRepository:
    """Agent 数据访问层。"""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create_session(self, **kwargs) -> AgentSession:
        """创建会话。"""
        session = AgentSession(**kwargs)
        self._db.add(session)
        await self._db.flush()
        await self._db.refresh(session)
        return session

    async def get_session(self, session_id: int, employee_id: int) -> AgentSession | None:
        """按 ID + employee_id 查询会话（仅 status=1 正常状态）。"""
        result = await self._db.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.employee_id == employee_id,
                AgentSession.status == 1,
            )
        )
        return result.scalar_one_or_none()

    async def list_sessions(
        self,
        employee_id: int,
        skip: int,
        limit: int,
        keyword: str | None = None,
    ) -> list[AgentSession]:
        """分页查询员工会话列表。"""
        query = select(AgentSession).where(
            AgentSession.employee_id == employee_id,
            AgentSession.status == 1,
        )
        if keyword:
            query = query.where(AgentSession.title.like(f"%{keyword}%"))
        result = await self._db.execute(
            query.order_by(
                AgentSession.create_time.desc(), AgentSession.id.desc(),
            ).offset(skip).limit(limit)
        )
        return result.scalars().all()

    async def count_sessions(self, employee_id: int, keyword: str | None = None) -> int:
        """统计员工会话总数。"""
        query = select(func.count(AgentSession.id)).where(
            AgentSession.employee_id == employee_id,
            AgentSession.status == 1,
        )
        if keyword:
            query = query.where(AgentSession.title.like(f"%{keyword}%"))
        result = await self._db.execute(query)
        return result.scalar() or 0

    async def update_session(self, session_id: int, **kwargs) -> AgentSession | None:
        """更新会话字段。"""
        await self._db.execute(update(AgentSession).where(AgentSession.id == session_id).values(**kwargs))
        await self._db.flush()
        result = await self._db.execute(select(AgentSession).where(AgentSession.id == session_id))
        return result.scalar_one_or_none()

    async def soft_delete_session(self, session_id: int) -> None:
        """软删除会话（status 置 0）。"""
        await self._db.execute(update(AgentSession).where(AgentSession.id == session_id).values(status=0))
        await self._db.flush()

    async def next_message_order(self, session_id: int) -> int:
        """获取下一条消息的 sort_order。"""
        result = await self._db.execute(
            select(func.max(AgentMessage.sort_order)).where(AgentMessage.session_id == session_id)
        )
        return (result.scalar() or 0) + 1

    async def create_message(self, **kwargs) -> AgentMessage:
        """创建消息。"""
        message = AgentMessage(**kwargs)
        self._db.add(message)
        await self._db.flush()
        await self._db.refresh(message)
        return message

    async def list_messages(self, session_id: int) -> list[AgentMessage]:
        """查询会话所有消息（按排序号升序）。"""
        result = await self._db.execute(
            select(AgentMessage)
            .where(AgentMessage.session_id == session_id)
            .order_by(AgentMessage.sort_order.asc(), AgentMessage.id.asc())
        )
        return result.scalars().all()

    async def update_message_content(self, message_id: int, content: dict) -> None:
        """更新 agent_message.content（跨消息回写 interaction 状态用）。"""
        stmt = update(AgentMessage).where(AgentMessage.id == message_id).values(content=content)
        await self._db.execute(stmt)
        await self._db.flush()

    async def commit(self) -> None:
        """提交事务。"""
        await self._db.commit()

    async def rollback(self) -> None:
        """回滚事务。"""
        await self._db.rollback()
