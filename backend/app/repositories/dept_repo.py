from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_position import JobPosition
from app.models.sys_dept import SysDept
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

    async def list_page(self, skip: int = 0, limit: int = 20, status: int = None, search: str = None) -> list[SysDept]:
        query = select(SysDept).where(SysDept.is_deleted == 0)
        if status is not None:
            query = query.where(SysDept.status == status)
        if search:
            query = query.where(or_(SysDept.dept_name.ilike(f"%{search}%"), SysDept.dept_code.ilike(f"%{search}%")))
        query = query.order_by(SysDept.sort_order.asc(), SysDept.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_count(self, status: int = None, search: str = None) -> int:
        query = select(func.count(SysDept.id)).where(SysDept.is_deleted == 0)
        if status is not None:
            query = query.where(SysDept.status == status)
        if search:
            query = query.where(or_(SysDept.dept_name.ilike(f"%{search}%"), SysDept.dept_code.ilike(f"%{search}%")))
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_by_id(self, dept_id: int) -> SysDept:
        result = await self.db.execute(select(SysDept).where(SysDept.id == dept_id, SysDept.is_deleted == 0))
        return result.scalar_one_or_none()

    async def get_by_code(self, dept_code: str) -> SysDept:
        result = await self.db.execute(select(SysDept).where(SysDept.dept_code == dept_code, SysDept.is_deleted == 0))
        return result.scalar_one_or_none()

    async def create(
        self,
        parent_id: int,
        dept_code: str,
        dept_name: str,
        leader_id: int,
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

    async def update(self, dept_id: int, **kwargs) -> SysDept:
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

    async def list_page_with_stats(
        self, skip: int = 0, limit: int = 20, status: int = None, search: str = None
    ) -> list[dict]:
        base_query = select(SysDept).where(SysDept.is_deleted == 0)
        if status is not None:
            base_query = base_query.where(SysDept.status == status)
        if search:
            base_query = base_query.where(
                or_(SysDept.dept_name.ilike(f"%{search}%"), SysDept.dept_code.ilike(f"%{search}%"))
            )

        depts_result = await self.db.execute(
            base_query.order_by(SysDept.sort_order.asc(), SysDept.id.desc()).offset(skip).limit(limit)
        )
        depts = depts_result.scalars().all()

        if not depts:
            return []

        dept_ids = [d.id for d in depts]
        count_query = (
            select(SysEmployee.dept_id, func.count(SysEmployee.id))
            .where(SysEmployee.dept_id.in_(dept_ids), SysEmployee.is_deleted == 0)
            .group_by(SysEmployee.dept_id)
        )
        count_result = await self.db.execute(count_query)
        count_map = dict(count_result.all())

        items = []
        for dept in depts:
            items.append({
                "id": dept.id,
                "parent_id": dept.parent_id or 0,
                "dept_code": dept.dept_code,
                "dept_name": dept.dept_name,
                "leader_id": dept.leader_id,
                "sort_order": dept.sort_order,
                "status": dept.status,
                "employee_count": count_map.get(dept.id, 0),
                "create_time": dept.create_time,
                "update_time": dept.update_time,
            })
        return items

    async def get_children_recursive(self, parent_id: int) -> list[int]:
        """递归获取所有子部门 ID"""
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
            {"parent_id": parent_id}
        )
        return [row[0] for row in result.fetchall()]
