from typing import Any
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.sys_dept import SysDept
from app.models.sys_dept_employee import SysDeptEmployee
from app.models.sys_employee import SysEmployee


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
        is_admin: int = 0,
    ) -> SysEmployee:
        employee = SysEmployee(
            emp_no=emp_no,
            email=email,
            password_hash=password_hash,
            real_name=real_name,
            phone=phone,
            status=status,
            is_admin=is_admin,
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
            "is_admin": int(getattr(employee, "is_admin", 0) or 0),
            "create_time": employee.create_time,
            "update_time": employee.update_time,
        }
