from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_action import AgentAction
from app.models.agent_message import AgentMessage
from app.models.agent_run import AgentRun
from app.models.agent_session import AgentSession


class AgentRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create_session(self, **kwargs) -> AgentSession:
        session = AgentSession(**kwargs)
        self._db.add(session)
        await self._db.commit()
        await self._db.refresh(session)
        return session

    async def get_session(self, session_id: int, employee_id: int) -> AgentSession | None:
        result = await self._db.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.employee_id == employee_id,
                AgentSession.is_deleted == 0,
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
        query = select(AgentSession).where(
            AgentSession.employee_id == employee_id,
            AgentSession.is_deleted == 0,
        )
        if keyword:
            query = query.where(AgentSession.title.like(f"%{keyword}%"))
        result = await self._db.execute(
            query.order_by(AgentSession.update_time.desc(), AgentSession.id.desc()).offset(skip).limit(limit)
        )
        return result.scalars().all()

    async def count_sessions(self, employee_id: int, keyword: str | None = None) -> int:
        query = select(func.count(AgentSession.id)).where(
            AgentSession.employee_id == employee_id,
            AgentSession.is_deleted == 0,
        )
        if keyword:
            query = query.where(AgentSession.title.like(f"%{keyword}%"))
        result = await self._db.execute(query)
        return result.scalar() or 0

    async def update_session(self, session_id: int, **kwargs) -> AgentSession | None:
        await self._db.execute(update(AgentSession).where(AgentSession.id == session_id).values(**kwargs))
        await self._db.commit()
        result = await self._db.execute(select(AgentSession).where(AgentSession.id == session_id))
        return result.scalar_one_or_none()

    async def soft_delete_session(self, session_id: int) -> None:
        await self._db.execute(update(AgentSession).where(AgentSession.id == session_id).values(is_deleted=1))
        await self._db.commit()

    async def next_message_order(self, session_id: int) -> int:
        result = await self._db.execute(
            select(func.max(AgentMessage.sort_order)).where(AgentMessage.session_id == session_id)
        )
        return (result.scalar() or 0) + 1

    async def create_message(self, **kwargs) -> AgentMessage:
        message = AgentMessage(**kwargs)
        self._db.add(message)
        await self._db.commit()
        await self._db.refresh(message)
        return message

    async def list_messages(self, session_id: int) -> list[AgentMessage]:
        result = await self._db.execute(
            select(AgentMessage)
            .where(AgentMessage.session_id == session_id)
            .order_by(AgentMessage.sort_order.asc(), AgentMessage.id.asc())
        )
        return result.scalars().all()

    async def create_run(self, **kwargs) -> AgentRun:
        run = AgentRun(**kwargs)
        self._db.add(run)
        await self._db.commit()
        await self._db.refresh(run)
        return run

    async def update_run(self, run_id: int, **kwargs) -> AgentRun | None:
        await self._db.execute(update(AgentRun).where(AgentRun.id == run_id).values(**kwargs))
        await self._db.commit()
        result = await self._db.execute(select(AgentRun).where(AgentRun.id == run_id))
        return result.scalar_one_or_none()

    async def list_runs(self, session_id: int) -> list[AgentRun]:
        result = await self._db.execute(
            select(AgentRun).where(AgentRun.session_id == session_id).order_by(AgentRun.id.desc())
        )
        return result.scalars().all()

    async def create_action(self, **kwargs) -> AgentAction:
        action = AgentAction(**kwargs)
        self._db.add(action)
        await self._db.commit()
        await self._db.refresh(action)
        return action

    async def get_action(self, action_id: int, employee_id: int) -> AgentAction | None:
        result = await self._db.execute(
            select(AgentAction).where(
                AgentAction.id == action_id,
                AgentAction.employee_id == employee_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_action(self, action_id: int, **kwargs) -> AgentAction | None:
        await self._db.execute(update(AgentAction).where(AgentAction.id == action_id).values(**kwargs))
        await self._db.commit()
        result = await self._db.execute(select(AgentAction).where(AgentAction.id == action_id))
        return result.scalar_one_or_none()

    async def update_pending_action(self, action_id: int, **kwargs) -> AgentAction | None:
        """仅允许待确认动作完成状态转换，避免并发确认/拒绝互相覆盖"""
        result = await self._db.execute(
            update(AgentAction)
            .where(AgentAction.id == action_id, AgentAction.status == 1)
            .values(**kwargs)
        )
        await self._db.commit()
        if (result.rowcount or 0) <= 0:
            return None
        query_result = await self._db.execute(select(AgentAction).where(AgentAction.id == action_id))
        return query_result.scalar_one_or_none()

    async def update_action_without_commit(self, action_id: int, **kwargs) -> AgentAction | None:
        """更新动作状态但不提交事务，由 Service 统一完成业务写操作与动作状态落库"""
        await self._db.execute(update(AgentAction).where(AgentAction.id == action_id).values(**kwargs))
        await self._db.flush()
        result = await self._db.execute(select(AgentAction).where(AgentAction.id == action_id))
        return result.scalar_one_or_none()

    async def update_pending_action_without_commit(self, action_id: int, **kwargs) -> AgentAction | None:
        """在同一事务内仅转换待确认动作，防止动作已被并发请求处理后再次执行"""
        result = await self._db.execute(
            update(AgentAction)
            .where(AgentAction.id == action_id, AgentAction.status == 1)
            .values(**kwargs)
        )
        await self._db.flush()
        if (result.rowcount or 0) <= 0:
            return None
        query_result = await self._db.execute(select(AgentAction).where(AgentAction.id == action_id))
        return query_result.scalar_one_or_none()

    async def commit(self) -> None:
        """提交当前请求会话中由 Service 编排完成的事务"""
        await self._db.commit()

    async def rollback(self) -> None:
        """回滚当前请求会话中由 Service 编排失败的事务"""
        await self._db.rollback()

    async def list_actions(self, session_id: int) -> list[AgentAction]:
        result = await self._db.execute(
            select(AgentAction).where(AgentAction.session_id == session_id).order_by(AgentAction.id.desc())
        )
        return result.scalars().all()
