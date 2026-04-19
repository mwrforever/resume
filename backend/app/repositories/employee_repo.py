from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.sys_employee import SysEmployee


class EmployeeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, employee_id: int) -> SysEmployee:
        result = await self.db.execute(
            select(SysEmployee).where(SysEmployee.id == employee_id, SysEmployee.is_deleted == 0)
        )
        return result.scalar_one_or_none()

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
