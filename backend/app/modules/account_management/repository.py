from typing import Any
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.models.job_position import JobPosition
from app.models.sys_dept import SysDept
from app.models.sys_dept_employee import SysDeptEmployee
from app.models.sys_employee import SysEmployee
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy import func, select, update
from app.models.sys_user import SysUser


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
    ) -> list[dict[str, Any]]:
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


class EmployeeRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, employee_id: int) -> SysEmployee:
        result = await self.db.execute(
            select(SysEmployee).where(SysEmployee.id == employee_id, SysEmployee.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_id_with_dept(self, employee_id: int) -> dict[str, Any] | None:
        result = await self.db.execute(
            self._employee_dept_query().where(SysEmployee.id == employee_id)
        )
        row = result.first()
        if not row:
            return None
        item = self._build_employee_item(row)
        item["depts"] = await self.list_employee_depts(employee_id)
        return item

    async def get_by_emp_no(self, emp_no: str) -> SysEmployee:
        result = await self.db.execute(
            select(SysEmployee).where(SysEmployee.emp_no == emp_no, SysEmployee.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> SysEmployee:
        result = await self.db.execute(
            select(SysEmployee).where(SysEmployee.email == email, SysEmployee.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_identifier(self, identifier: str) -> SysEmployee:
        # First try emp_no, then email
        employee = await self.get_by_emp_no(identifier)
        if not employee:
            employee = await self.get_by_email(identifier)
        return employee

    async def create(
        self,
        emp_no: str,
        email: str,
        password_hash: str,
        real_name: str,
        phone: str = None,
        status: int = 1,
    ) -> SysEmployee:
        employee = SysEmployee(
            emp_no=emp_no,
            email=email,
            password_hash=password_hash,
            real_name=real_name,
            phone=phone,
            status=status,
        )
        self.db.add(employee)
        await self.db.commit()
        await self.db.refresh(employee)
        return employee

    async def get_count(self, status: int = None, search: str = None) -> int:
        query = select(func.count(SysEmployee.id)).where(SysEmployee.is_deleted == 0)
        if status is not None:
            query = query.where(SysEmployee.status == status)
        if search:
            query = query.where(
                (SysEmployee.emp_no.ilike(f"%{search}%"))
                | (SysEmployee.email.ilike(f"%{search}%"))
                | (SysEmployee.real_name.ilike(f"%{search}%"))
                | (SysEmployee.phone.ilike(f"%{search}%"))
            )
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def list_page(
        self,
        skip: int = 0,
        limit: int = 20,
        status: int = None,
        search: str = None,
    ) -> list[SysEmployee]:
        query = select(SysEmployee).where(SysEmployee.is_deleted == 0)
        if status is not None:
            query = query.where(SysEmployee.status == status)
        if search:
            query = query.where(
                (SysEmployee.emp_no.ilike(f"%{search}%"))
                | (SysEmployee.email.ilike(f"%{search}%"))
                | (SysEmployee.real_name.ilike(f"%{search}%"))
                | (SysEmployee.phone.ilike(f"%{search}%"))
            )
        query = query.order_by(SysEmployee.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def list_page_with_dept(
        self,
        skip: int = 0,
        limit: int = 20,
        status: int = None,
        search: str = None,
    ) -> list[dict[str, Any]]:
        query = self._employee_dept_query()
        if status is not None:
            query = query.where(SysEmployee.status == status)
        if search:
            query = query.where(
                (SysEmployee.emp_no.ilike(f"%{search}%"))
                | (SysEmployee.email.ilike(f"%{search}%"))
                | (SysEmployee.real_name.ilike(f"%{search}%"))
                | (SysEmployee.phone.ilike(f"%{search}%"))
            )
        result = await self.db.execute(query.order_by(SysEmployee.id.desc()).offset(skip).limit(limit))
        items = [self._build_employee_item(row) for row in result.all()]
        dept_map = await self.list_employee_depts_map([item["id"] for item in items])
        for item in items:
            item["depts"] = dept_map.get(item["id"], [])
        return items

    async def update(self, employee_id: int, **kwargs: Any) -> SysEmployee:
        await self.db.execute(
            update(SysEmployee).where(SysEmployee.id == employee_id, SysEmployee.is_deleted == 0).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_by_id(employee_id)

    async def delete(self, employee_id: int) -> bool:
        await self.db.execute(
            update(SysEmployee).where(SysEmployee.id == employee_id, SysEmployee.is_deleted == 0).values(is_deleted=1)
        )
        await self.db.commit()
        return True

    async def assign_primary_dept(self, employee_id: int, dept_id: int | None) -> None:
        conditions = [SysDeptEmployee.employee_id == employee_id, SysDeptEmployee.is_primary == 1]
        if dept_id:
            conditions = [
                SysDeptEmployee.employee_id == employee_id,
                or_(SysDeptEmployee.is_primary == 1, SysDeptEmployee.dept_id == dept_id),
            ]
        await self.db.execute(delete(SysDeptEmployee).where(*conditions))
        if dept_id:
            self.db.add(SysDeptEmployee(employee_id=employee_id, dept_id=dept_id, is_primary=1))
        await self.db.commit()

    async def assign_depts(self, employee_id: int, dept_ids: list[int], primary_dept_id: int | None) -> None:
        await self.db.execute(delete(SysDeptEmployee).where(SysDeptEmployee.employee_id == employee_id))
        for dept_id in dept_ids:
            self.db.add(SysDeptEmployee(
                employee_id=employee_id,
                dept_id=dept_id,
                is_primary=1 if dept_id == primary_dept_id else 0,
            ))
        await self.db.commit()

    async def list_employee_depts(self, employee_id: int) -> list[dict[str, Any]]:
        dept_map = await self.list_employee_depts_map([employee_id])
        return dept_map.get(employee_id, [])

    async def list_employee_depts_map(self, employee_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
        if not employee_ids:
            return {}
        result = await self.db.execute(
            select(
                SysDeptEmployee.employee_id,
                SysDeptEmployee.dept_id,
                SysDept.dept_name,
                SysDeptEmployee.is_primary,
            )
            .join(SysDept, (SysDept.id == SysDeptEmployee.dept_id) & (SysDept.is_deleted == 0))
            .where(SysDeptEmployee.employee_id.in_(employee_ids))
            .order_by(SysDeptEmployee.is_primary.desc(), SysDept.id.asc())
        )
        dept_map: dict[int, list[dict[str, Any]]] = {}
        for row in result.all():
            dept_map.setdefault(row.employee_id, []).append({
                "dept_id": row.dept_id,
                "dept_name": row.dept_name,
                "is_primary": row.is_primary,
            })
        return dept_map

    def _employee_dept_query(self):
        return (
            select(
                SysEmployee,
                SysDept.id.label("dept_id"),
                SysDept.dept_name.label("dept_name"),
            )
            .outerjoin(
                SysDeptEmployee,
                (SysDeptEmployee.employee_id == SysEmployee.id) & (SysDeptEmployee.is_primary == 1),
            )
            .outerjoin(SysDept, (SysDept.id == SysDeptEmployee.dept_id) & (SysDept.is_deleted == 0))
            .where(SysEmployee.is_deleted == 0)
        )

    def _build_employee_item(self, row: tuple) -> dict[str, Any]:
        employee = row[0]
        return {
            "id": employee.id,
            "emp_no": employee.emp_no,
            "real_name": employee.real_name,
            "email": employee.email,
            "phone": employee.phone,
            "dept_id": row.dept_id or 0,
            "dept_name": row.dept_name,
            "status": employee.status,
            "create_time": employee.create_time,
            "update_time": employee.update_time,
        }


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: int) -> SysUser:
        result = await self.db.execute(
            select(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> SysUser:
        result = await self.db.execute(
            select(SysUser).where(SysUser.email == email, SysUser.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def get_by_identifier(self, identifier: str) -> SysUser:
        # identifier can be username or email
        result = await self.db.execute(
            select(SysUser).where(
                (SysUser.email == identifier) | (SysUser.real_name == identifier),
                SysUser.is_deleted == 0
            )
        )
        return result.scalar_one_or_none()

    async def create(self, email: str, password_hash: str, real_name: str) -> SysUser:
        user = SysUser(email=email, password_hash=password_hash, real_name=real_name)
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def get_count(self, status: int = None, search: str = None) -> int:
        query = select(func.count(SysUser.id)).where(SysUser.is_deleted == 0)
        if status is not None:
            query = query.where(SysUser.status == status)
        if search:
            query = query.where((SysUser.email.ilike(f"%{search}%")) | (SysUser.real_name.ilike(f"%{search}%")))
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def list_page(self, skip: int = 0, limit: int = 20, status: int = None, search: str = None) -> list[SysUser]:
        query = select(SysUser).where(SysUser.is_deleted == 0)
        if status is not None:
            query = query.where(SysUser.status == status)
        if search:
            query = query.where((SysUser.email.ilike(f"%{search}%")) | (SysUser.real_name.ilike(f"%{search}%")))
        query = query.order_by(SysUser.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def update(self, user_id: int, **kwargs) -> SysUser:
        await self.db.execute(
            update(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_by_id(user_id)

    async def delete(self, user_id: int) -> bool:
        await self.db.execute(
            update(SysUser).where(SysUser.id == user_id, SysUser.is_deleted == 0).values(is_deleted=1)
        )
        await self.db.commit()
        return True
