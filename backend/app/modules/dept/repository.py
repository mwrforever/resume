from typing import Any
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.inspection import Inspectable
from sqlalchemy.orm import aliased
from sqlalchemy.sql._typing import _HasClauseElement
from sqlalchemy.sql.elements import SQLCoreOperations
from sqlalchemy.sql.roles import ColumnsClauseRole, TypedColumnsClauseRole

from app.models.job_position import JobPosition
from app.models.sys_dept import SysDept
from app.models.sys_dept_employee import SysDeptEmployee
from app.models.sys_employee import SysEmployee


class DeptRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_active(self) -> list[SysDept]:
        result = await self.db.execute(
            select(SysDept)
            .where(SysDept.is_deleted == 0, SysDept.status == 1)
            .order_by(SysDept.sort_order.asc(), SysDept.id.asc())
        )
        return result.scalars().all()

    async def list_page_with_stats(
        self,
        skip: int = 0,
        limit: int = 20,
        status: int = None,
        search: str = None,
    ) -> list[dict[str | SQLCoreOperations[Any] | TypedColumnsClauseRole[Any] | ColumnsClauseRole | type | Inspectable[
        _HasClauseElement[Any]], Any]]:
        query = self._stats_query()
        query = self._apply_filters(query, status=status, search=search)
        result = await self.db.execute(query.order_by(SysDept.sort_order.asc(), SysDept.id.desc()).offset(skip).limit(limit))
        return [dict(row) for row in result.mappings().all()]

    async def list_tree_items_with_stats(self) -> list[dict[str, Any]]:
        result = await self.db.execute(self._stats_query().order_by(SysDept.sort_order.asc(), SysDept.id.asc()))
        return [dict(row) for row in result.mappings().all()]

    async def get_item_by_id(self, dept_id: int) -> dict[str, Any] | None:
        result = await self.db.execute(self._stats_query().where(SysDept.id == dept_id))
        row = result.mappings().first()
        return dict(row) if row else None

    async def get_count(self, status: int = None, search: str = None) -> int:
        query = select(func.count(SysDept.id)).where(SysDept.is_deleted == 0)
        query = self._apply_filters(query, status=status, search=search)
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_by_id(self, dept_id: int) -> SysDept | None:
        result = await self.db.execute(select(SysDept).where(SysDept.id == dept_id, SysDept.is_deleted == 0))
        return result.scalar_one_or_none()

    async def get_by_code(self, dept_code: str) -> SysDept | None:
        result = await self.db.execute(select(SysDept).where(SysDept.dept_code == dept_code, SysDept.is_deleted == 0))
        return result.scalar_one_or_none()

    async def get_employee_by_id(self, employee_id: int) -> SysEmployee | None:
        result = await self.db.execute(select(SysEmployee).where(SysEmployee.id == employee_id, SysEmployee.is_deleted == 0))
        return result.scalar_one_or_none()

    async def get_employee_by_real_name(self, real_name: str) -> SysEmployee | None:
        result = await self.db.execute(
            select(SysEmployee)
            .where(SysEmployee.real_name == real_name, SysEmployee.is_deleted == 0)
            .order_by(SysEmployee.id.asc())
        )
        return result.scalars().first()

    async def create(
        self,
        parent_id: int,
        dept_code: str,
        dept_name: str,
        leader_id: int | None,
        sort_order: int,
        status: int,
    ) -> SysDept:
        dept = SysDept(
            parent_id=parent_id,
            dept_code=dept_code,
            dept_name=dept_name,
            leader_id=leader_id,
            sort_order=sort_order,
            status=status,
        )
        self.db.add(dept)
        await self.db.commit()
        await self.db.refresh(dept)
        return dept

    async def update(self, dept_id: int, **kwargs) -> SysDept | None:
        await self.db.execute(update(SysDept).where(SysDept.id == dept_id, SysDept.is_deleted == 0).values(**kwargs))
        await self.db.commit()
        return await self.get_by_id(dept_id)

    async def delete(self, dept_id: int) -> bool:
        await self.db.execute(update(SysDept).where(SysDept.id == dept_id, SysDept.is_deleted == 0).values(is_deleted=1))
        await self.db.commit()
        return True

    async def count_jobs(self, dept_id: int) -> int:
        result = await self.db.execute(
            select(func.count(JobPosition.id)).where(JobPosition.dept_id == dept_id, JobPosition.is_deleted == 0)
        )
        return result.scalar() or 0

    async def count_children(self, dept_id: int) -> int:
        result = await self.db.execute(
            select(func.count(SysDept.id)).where(SysDept.parent_id == dept_id, SysDept.is_deleted == 0)
        )
        return result.scalar() or 0

    async def count_active_employees(self, dept_id: int) -> int:
        result = await self.db.execute(
            select(func.count(SysEmployee.id))
            .join(SysDeptEmployee, SysDeptEmployee.employee_id == SysEmployee.id)
            .where(
                SysDeptEmployee.dept_id == dept_id,
                SysEmployee.status == 1,
                SysEmployee.is_deleted == 0,
            )
        )
        return result.scalar() or 0

    async def list_active_employees(self) -> list[SysEmployee]:
        result = await self.db.execute(
            select(SysEmployee)
            .where(SysEmployee.is_deleted == 0, SysEmployee.status == 1)
            .order_by(SysEmployee.id.asc())
        )
        return result.scalars().all()

    async def get_children_recursive(self, parent_id: int) -> list[int]:
        result = await self.db.execute(
            text("""
                WITH RECURSIVE dept_tree AS (
                    SELECT id FROM sys_dept WHERE parent_id = :parent_id AND is_deleted = 0
                    UNION ALL
                    SELECT d.id FROM sys_dept d JOIN dept_tree dt ON d.parent_id = dt.id
                    WHERE d.is_deleted = 0
                )
                SELECT id FROM dept_tree
            """),
            {"parent_id": parent_id},
        )
        return [row[0] for row in result.fetchall()]

    def _stats_query(self):
        ParentDept = aliased(SysDept)
        Leader = aliased(SysEmployee)
        CountEmployee = aliased(SysEmployee)
        DeptEmployee = aliased(SysDeptEmployee)
        return (
            select(
                SysDept.id.label("id"),
                SysDept.parent_id.label("parent_id"),
                ParentDept.dept_name.label("parent_name"),
                SysDept.dept_code.label("dept_code"),
                SysDept.dept_name.label("dept_name"),
                SysDept.leader_id.label("leader_id"),
                Leader.real_name.label("leader_name"),
                func.count(CountEmployee.id).label("employee_count"),
                SysDept.sort_order.label("sort_order"),
                SysDept.status.label("status"),
                SysDept.create_time.label("create_time"),
                SysDept.update_time.label("update_time"),
            )
            .select_from(SysDept)
            .outerjoin(ParentDept, (ParentDept.id == SysDept.parent_id) & (ParentDept.is_deleted == 0))
            .outerjoin(Leader, (Leader.id == SysDept.leader_id) & (Leader.is_deleted == 0))
            .outerjoin(DeptEmployee, DeptEmployee.dept_id == SysDept.id)
            .outerjoin(CountEmployee, (CountEmployee.id == DeptEmployee.employee_id) & (CountEmployee.is_deleted == 0))
            .where(SysDept.is_deleted == 0)
            .group_by(
                SysDept.id,
                SysDept.parent_id,
                ParentDept.dept_name,
                SysDept.dept_code,
                SysDept.dept_name,
                SysDept.leader_id,
                Leader.real_name,
                SysDept.sort_order,
                SysDept.status,
                SysDept.create_time,
                SysDept.update_time,
            )
        )

    def _apply_filters(self, query, status: int = None, search: str = None):
        if status is not None:
            query = query.where(SysDept.status == status)
        if search:
            query = query.where(or_(SysDept.dept_name.ilike(f"%{search}%"), SysDept.dept_code.ilike(f"%{search}%")))
        return query
