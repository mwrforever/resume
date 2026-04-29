import csv
import io
from typing import Any

from app.utils.auth import ensure_admin
from app.infrastructure.exception import NotFoundError, ValidationError
from app.utils.security import get_password_hash
from app.schemas.vo.response.account_management_response import ManagedEmployeeItem


class EmployeeManageService:
    def __init__(self, employee_repo, dept_repo):
        self.employee_repo = employee_repo
        self.dept_repo = dept_repo

    async def ensure_admin(self, current_user: dict) -> None:
        await ensure_admin(current_user, self.employee_repo)

    async def list_employees(self, page: int, page_size: int, status: int = None, search: str = None) -> dict[str, Any]:
        skip = (page - 1) * page_size
        employees = await self.employee_repo.list_page_with_dept(skip=skip, limit=page_size, status=status, search=search)
        total = await self.employee_repo.get_count(status=status, search=search)
        return {"total": total, "items": [ManagedEmployeeItem(**e) for e in employees]}

    async def get_employee(self, employee_id: int) -> ManagedEmployeeItem:
        employee = await self.employee_repo.get_by_id_with_dept(employee_id)
        if not employee:
            raise NotFoundError("员工不存在")
        return ManagedEmployeeItem(**employee)

    async def create_employee(self, body) -> ManagedEmployeeItem:
        await self._ensure_employee_unique(emp_no=body.emp_no, email=str(body.email))
        dept_ids, primary_dept_id = self._resolve_dept_assignment(body.dept_id, body.dept_ids, body.primary_dept_id)
        await self._ensure_depts_exist(dept_ids)
        employee = await self.employee_repo.create(
            emp_no=body.emp_no,
            email=str(body.email),
            password_hash=get_password_hash(body.password),
            real_name=body.real_name,
            phone=body.phone,
            status=body.status,
        )
        if dept_ids:
            await self.employee_repo.assign_depts(employee.id, dept_ids, primary_dept_id)
        return await self.get_employee(employee.id)

    async def update_employee(self, employee_id: int, body) -> ManagedEmployeeItem:
        employee = await self.employee_repo.get_by_id(employee_id)
        if not employee:
            raise NotFoundError("员工不存在")
        payload = body.model_dump(exclude_unset=True)
        email = payload.get("email")
        emp_no = payload.get("emp_no")
        await self._ensure_employee_unique(
            emp_no=emp_no,
            email=str(email) if email else None,
            exclude_employee_id=employee_id,
        )
        if email:
            payload["email"] = str(email)
        password = payload.pop("password", None)
        dept_id = payload.pop("dept_id", None)
        dept_ids = payload.pop("dept_ids", None)
        primary_dept_id = payload.pop("primary_dept_id", None)
        has_dept_assignment = dept_id is not None or dept_ids is not None or primary_dept_id is not None
        if has_dept_assignment:
            dept_ids, primary_dept_id = self._resolve_dept_assignment(dept_id, dept_ids, primary_dept_id)
            await self._ensure_depts_exist(dept_ids)
        if password:
            payload["password_hash"] = get_password_hash(password)
        if payload:
            employee = await self.employee_repo.update(employee_id, **payload)
        if has_dept_assignment:
            await self.employee_repo.assign_depts(employee_id, dept_ids, primary_dept_id)
        return await self.get_employee(employee.id)

    async def delete_employee(self, employee_id: int, current_employee_id: int) -> None:
        employee = await self.employee_repo.get_by_id(employee_id)
        if not employee:
            raise NotFoundError("员工不存在")
        if employee_id == current_employee_id:
            raise ValidationError("不能删除当前登录员工")
        await self.employee_repo.delete(employee_id)

    async def import_employees(self, content: bytes) -> dict[str, Any]:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        allowed_fields = {"emp_no", "real_name", "email", "phone", "password", "status"}
        required_fields = {"emp_no", "real_name", "email", "password"}
        if not reader.fieldnames:
            raise ValidationError("CSV表头不能为空")
        fields = {field.strip() for field in reader.fieldnames}
        unknown_fields = fields - allowed_fields
        missing_fields = required_fields - fields
        if unknown_fields:
            raise ValidationError(f"不支持的字段：{', '.join(sorted(unknown_fields))}")
        if missing_fields:
            raise ValidationError(f"缺少必填字段：{', '.join(sorted(missing_fields))}")

        success_count = 0
        errors = []
        for index, row in enumerate(reader, start=2):
            data = {key: (value or "").strip() for key, value in row.items() if key}
            row_errors = self._validate_import_row(data)
            if not row_errors:
                existing_email = await self.employee_repo.get_by_email(data["email"])
                existing_emp_no = await self.employee_repo.get_by_emp_no(data["emp_no"])
                if existing_email:
                    row_errors.append("邮箱已存在")
                if existing_emp_no:
                    row_errors.append("员工工号已存在")
            if row_errors:
                errors.append({"line": index, "message": "；".join(row_errors)})
                continue
            await self.employee_repo.create(
                emp_no=data["emp_no"],
                email=data["email"],
                password_hash=get_password_hash(data["password"]),
                real_name=data["real_name"],
                phone=data.get("phone") or None,
                status=int(data.get("status") or 1),
            )
            success_count += 1
        return {"success_count": success_count, "fail_count": len(errors), "errors": errors}

    async def _ensure_employee_unique(self, emp_no: str = None, email: str = None, exclude_employee_id: int = None) -> None:
        if emp_no:
            existing = await self.employee_repo.get_by_emp_no(emp_no)
            if existing and existing.id != exclude_employee_id:
                raise ValidationError("该员工工号已存在")
        if email:
            existing = await self.employee_repo.get_by_email(email)
            if existing and existing.id != exclude_employee_id:
                raise ValidationError("该邮箱已存在")

    async def _ensure_dept_exists(self, dept_id: int | None) -> None:
        if dept_id and not await self.dept_repo.get_by_id(dept_id):
            raise ValidationError("部门不存在")

    async def _ensure_depts_exist(self, dept_ids: list[int]) -> None:
        for dept_id in dept_ids:
            await self._ensure_dept_exists(dept_id)

    def _resolve_dept_assignment(self, dept_id: int | None, dept_ids: list[int] | None, primary_dept_id: int | None) -> tuple[list[int], int | None]:
        resolved_dept_ids = [item for item in dict.fromkeys(dept_ids or []) if item]
        resolved_primary_dept_id = primary_dept_id or None
        if not resolved_dept_ids and dept_id:
            resolved_dept_ids = [dept_id]
            resolved_primary_dept_id = dept_id
        if not resolved_dept_ids:
            return [], None
        if not resolved_primary_dept_id:
            resolved_primary_dept_id = resolved_dept_ids[0]
        if resolved_primary_dept_id not in resolved_dept_ids:
            raise ValidationError("主部门必须在已选择部门中")
        return resolved_dept_ids, resolved_primary_dept_id

    def _validate_import_row(self, data: dict[str, str]) -> list[str]:
        errors = []
        for field in ["emp_no", "real_name", "email", "password"]:
            if not data.get(field):
                errors.append(f"{field}不能为空")
        status = data.get("status")
        if status and status not in {"0", "1"}:
            errors.append("status只能为0或1")
        return errors
