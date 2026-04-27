import csv
import io
from collections import defaultdict
from typing import Any

from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.dept_repo import DeptRepository
from app.schemas.dept import DeptCreate, DeptItem, DeptUpdate


class DeptService:
    def __init__(self, repo: DeptRepository):
        self.repo = repo

    async def list_active(self) -> list[dict]:
        depts = await self.repo.list_active()
        return [{"id": dept.id, "dept_name": dept.dept_name, "dept_code": dept.dept_code} for dept in depts]

    async def get_tree(self) -> list[dict]:
        """获取部门树形结构"""
        depts = await self.repo.list_active()
        children_map: dict[int, list[dict]] = defaultdict(list)

        # 收集所有 leader_id 并获取 leader_name
        leader_ids = {d.leader_id for d in depts if d.leader_id}
        leader_names: dict[int, str] = {}
        if leader_ids:
            from app.repositories.employee_repo import EmployeeRepository
            emp_repo = EmployeeRepository(self.repo.db)
            for emp_id in leader_ids:
                emp = await emp_repo.get_by_id(emp_id)
                if emp:
                    leader_names[emp_id] = emp.real_name

        # First pass: build children_map
        for d in depts:
            children_map[d.parent_id or 0].append({
                "id": d.id,
                "key": d.id,
                "title": d.dept_name,
                "dept_code": d.dept_code,
                "parent_id": d.parent_id or 0,
                "leader_id": d.leader_id,
                "leader_name": leader_names.get(d.leader_id),
                "status": d.status,
                "sort_order": d.sort_order,
                "children": [],
            })

        # Second pass: attach children to parents
        def attach_children(parent_id: int) -> list[dict]:
            return [
                {**item, "children": attach_children(item["id"])}
                for item in children_map.get(parent_id, [])
            ]

        return attach_children(0)

    async def list_page(self, page: int, page_size: int, status: int = None, search: str = None) -> dict[str, Any]:
        skip = (page - 1) * page_size
        depts = await self.repo.list_page_with_stats(skip=skip, limit=page_size, status=status, search=search)
        total = await self.repo.get_count(status=status, search=search)

        # 补充 leader_name
        leader_ids = {d["leader_id"] for d in depts if d.get("leader_id")}
        leader_names: dict[int, str] = {}
        if leader_ids:
            from app.repositories.employee_repo import EmployeeRepository
            emp_repo = EmployeeRepository(self.repo.db)
            for emp_id in leader_ids:
                emp = await emp_repo.get_by_id(emp_id)
                if emp:
                    leader_names[emp_id] = emp.real_name

        for item in depts:
            item["leader_name"] = leader_names.get(item["leader_id"])

        return {"total": total, "items": depts}

    async def get_dept(self, dept_id: int) -> DeptItem:
        dept = await self.repo.get_by_id(dept_id)
        if not dept:
            raise NotFoundError("部门不存在")
        return await self._build_item(dept)

    async def create_dept(self, body: DeptCreate) -> DeptItem:
        await self._validate_payload(body.model_dump())
        dept = await self.repo.create(
            parent_id=body.parent_id,
            dept_code=body.dept_code,
            dept_name=body.dept_name,
            leader_id=body.leader_id,
            sort_order=body.sort_order,
            status=body.status,
        )
        return await self._build_item(dept)

    async def update_dept(self, dept_id: int, body: DeptUpdate) -> DeptItem:
        dept = await self.repo.get_by_id(dept_id)
        if not dept:
            raise NotFoundError("部门不存在")
        payload = body.model_dump(exclude_unset=True)
        await self._validate_payload(payload, dept_id=dept_id)
        if payload:
            dept = await self.repo.update(dept_id, **payload)
        return await self._build_item(dept)

    async def delete_dept(self, dept_id: int) -> None:
        dept = await self.repo.get_by_id(dept_id)
        if not dept:
            raise NotFoundError("部门不存在")
        if await self.repo.count_jobs(dept_id) > 0:
            raise ValidationError("已有岗位关联该部门，不允许删除")
        if await self.repo.count_children(dept_id) > 0:
            raise ValidationError("该部门存在子部门，不允许删除")
        await self.repo.delete(dept_id)

    async def import_depts(self, content: bytes) -> dict[str, Any]:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        allowed_fields = {"dept_name", "dept_code", "parent_id", "leader_id", "sort_order", "status"}
        required_fields = {"dept_name"}
        if not reader.fieldnames:
            raise ValidationError("CSV表头不能为空")
        fields = {field.strip() for field in reader.fieldnames}
        unknown_fields = fields - allowed_fields
        missing_fields = required_fields - fields
        if unknown_fields:
            raise ValidationError(f"不支持的字段：{', '.join(sorted(unknown_fields))}")
        if missing_fields:
            raise ValidationError(f"缺少必填字段：{', '.join(sorted(missing_fields))}")

        # 转换为列表以便多次迭代
        rows = list(reader)

        # 检查 CSV 中是否有重复 dept_code
        codes_in_csv: set[str] = set()
        for row in rows:
            code = (row.get("dept_code") or "").strip()
            if code:
                if code in codes_in_csv:
                    raise ValidationError(f"CSV 中部门编码 {code} 重复出现")
                existing = await self.repo.get_by_code(code)
                if existing:
                    raise ValidationError(f"部门编码 {code} 在系统中已存在")
                codes_in_csv.add(code)

        success_count = 0
        errors = []
        for index, row in enumerate(rows, start=2):
            data = {key: (value or "").strip() for key, value in row.items() if key}
            row_errors = await self._validate_import_row(data)
            if row_errors:
                errors.append({"line": index, "message": "；".join(row_errors)})
                continue
            await self.repo.create(
                parent_id=int(data.get("parent_id") or 0),
                dept_code=data.get("dept_code") or None,
                dept_name=data["dept_name"],
                leader_id=int(data["leader_id"]) if data.get("leader_id") else None,
                sort_order=int(data.get("sort_order") or 0),
                status=int(data.get("status") or 1),
            )
            success_count += 1
        return {"success_count": success_count, "fail_count": len(errors), "errors": errors}

    async def _build_item(self, dept) -> DeptItem:
        item = DeptItem.model_validate(dept).model_dump()
        item["job_count"] = await self.repo.count_jobs(dept.id)
        item["child_count"] = await self.repo.count_children(dept.id)
        return DeptItem(**item)

    async def _validate_payload(self, payload: dict[str, Any], dept_id: int = None) -> None:
        dept_name = payload.get("dept_name")
        if dept_name is not None and not str(dept_name).strip():
            raise ValidationError("部门名称不能为空")
        status = payload.get("status")
        if status is not None and status not in {0, 1}:
            raise ValidationError("状态只能为0或1")
        parent_id = payload.get("parent_id")
        if parent_id is not None:
            if parent_id == dept_id:
                raise ValidationError("父部门不能选择自身")
            if parent_id != 0 and not await self.repo.get_by_id(parent_id):
                raise ValidationError("父部门不存在")
        dept_code = payload.get("dept_code")
        if dept_code:
            existing = await self.repo.get_by_code(dept_code)
            if existing and existing.id != dept_id:
                raise ValidationError("部门编码已存在")

    async def _validate_import_row(self, data: dict[str, str]) -> list[str]:
        errors = []
        if not data.get("dept_name"):
            errors.append("dept_name不能为空")
        for field in ["parent_id", "leader_id", "sort_order"]:
            value = data.get(field)
            if value and not value.isdigit():
                errors.append(f"{field}只能为非负整数")
        status = data.get("status")
        if status and status not in {"0", "1"}:
            errors.append("status只能为0或1")
        parent_id = data.get("parent_id")
        if parent_id and int(parent_id) != 0 and not await self.repo.get_by_id(int(parent_id)):
            errors.append("父部门不存在")
        dept_code = data.get("dept_code")
        if dept_code and await self.repo.get_by_code(dept_code):
            errors.append("部门编码已存在")
        return errors
