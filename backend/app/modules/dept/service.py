import csv
import io
from collections import defaultdict
from typing import Any

from app.infrastructure.exception import NotFoundError, ValidationError
from app.modules.dept.repository import DeptRepository
from app.schemas.vo.request.dept_request import DeptCreate, DeptUpdate
from app.schemas.vo.response.dept_response import DeptItem


class DeptService:
    def __init__(self, repo: DeptRepository):
        self.repo = repo

    async def list_active(self) -> list[dict]:
        depts = await self.repo.list_active()
        return [
            {
                "id": dept.id,
                "parent_id": dept.parent_id or 0,
                "dept_name": dept.dept_name,
                "dept_code": dept.dept_code,
            }
            for dept in depts
        ]

    async def get_tree(self) -> list[dict]:
        depts = await self.repo.list_tree_items_with_stats()
        children_map: dict[int, list[dict]] = defaultdict(list)
        for dept in depts:
            parent_id = dept["parent_id"] or 0
            item = {**dept, "parent_id": parent_id, "key": dept["id"], "title": dept["dept_name"], "children": []}
            children_map[parent_id].append(item)

        def attach_children(parent_id: int) -> list[dict]:
            return [{**item, "children": attach_children(item["id"])} for item in children_map.get(parent_id, [])]

        return attach_children(0)

    async def list_leader_options(self) -> list[dict]:
        employees = await self.repo.list_active_employees()
        return [{"id": employee.id, "real_name": employee.real_name} for employee in employees]

    async def list_page(self, page: int, page_size: int, status: int = None, search: str = None) -> dict[str, Any]:
        skip = (page - 1) * page_size
        depts = await self.repo.list_page_with_stats(skip=skip, limit=page_size, status=status, search=search)
        total = await self.repo.get_count(status=status, search=search)
        return {"total": total, "items": [self._normalize_item(item) for item in depts]}

    async def get_dept(self, dept_id: int) -> DeptItem:
        item = await self.repo.get_item_by_id(dept_id)
        if not item:
            raise NotFoundError("部门不存在")
        return DeptItem(**self._normalize_item(item))

    async def create_dept(self, body: DeptCreate) -> DeptItem:
        payload = body.model_dump()
        await self._validate_payload(payload, creating=True)
        dept = await self.repo.create(
            parent_id=payload.get("parent_id") or 0,
            dept_code=payload["dept_code"].strip(),
            dept_name=payload["dept_name"].strip(),
            leader_id=payload.get("leader_id"),
            sort_order=payload.get("sort_order") or 0,
            status=payload.get("status") if payload.get("status") is not None else 1,
        )
        return await self.get_dept(dept.id)

    async def update_dept(self, dept_id: int, body: DeptUpdate) -> DeptItem:
        dept = await self.repo.get_by_id(dept_id)
        if not dept:
            raise NotFoundError("部门不存在")
        payload = body.model_dump(exclude_unset=True)
        await self._validate_payload(payload, dept_id=dept_id)
        if "parent_id" in payload:
            payload["parent_id"] = payload["parent_id"] or 0
        if "dept_code" in payload and payload["dept_code"] is not None:
            payload["dept_code"] = payload["dept_code"].strip()
        if "dept_name" in payload and payload["dept_name"] is not None:
            payload["dept_name"] = payload["dept_name"].strip()
        if payload:
            await self.repo.update(dept_id, **payload)
        return await self.get_dept(dept_id)

    async def delete_dept(self, dept_id: int) -> None:
        dept = await self.repo.get_by_id(dept_id)
        if not dept:
            raise NotFoundError("部门不存在")
        if await self.repo.count_jobs(dept_id) > 0:
            raise ValidationError("已有岗位关联该部门，不允许删除")
        if await self.repo.count_active_employees(dept_id) > 0:
            raise ValidationError("该部门下存在正常状态员工，不允许删除")
        if await self.repo.count_children(dept_id) > 0:
            raise ValidationError("该部门存在子部门，不允许删除")
        await self.repo.delete(dept_id)

    async def import_depts(self, content: bytes) -> dict[str, Any]:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        allowed_fields = {"dept_code", "dept_name", "parent_code", "leader_name", "sort_order", "status"}
        required_fields = {"dept_code", "dept_name"}
        if not reader.fieldnames:
            raise ValidationError("CSV表头不能为空")
        fields = {field.strip() for field in reader.fieldnames if field}
        unknown_fields = fields - allowed_fields
        missing_fields = required_fields - fields
        if unknown_fields:
            raise ValidationError(f"不支持的字段：{', '.join(sorted(unknown_fields))}")
        if missing_fields:
            raise ValidationError(f"缺少必填字段：{', '.join(sorted(missing_fields))}")

        rows = [
            {key.strip(): (value or "").strip() for key, value in row.items() if key}
            for row in reader
        ]
        await self._ensure_import_codes_unique(rows)
        existing_code_ids = await self._get_existing_code_ids(rows)
        valid_rows = []
        errors = []
        csv_codes = {row.get("dept_code", "") for row in rows if row.get("dept_code")}
        leader_cache: dict[str, int | None] = {}
        for index, data in enumerate(rows, start=2):
            row_errors = await self._validate_import_row(data, existing_code_ids, csv_codes, leader_cache)
            if row_errors:
                errors.append({"line": index, "message": "；".join(row_errors)})
                continue
            valid_rows.append({"line": index, "data": data, "leader_id": leader_cache.get(data.get("leader_name", ""))})

        success_count = 0
        pending = valid_rows.copy()
        while pending:
            next_pending = []
            progress = False
            for item in pending:
                data = item["data"]
                parent_code = data.get("parent_code") or ""
                if parent_code and parent_code not in existing_code_ids:
                    next_pending.append(item)
                    continue
                dept = await self.repo.create(
                    parent_id=existing_code_ids.get(parent_code, 0),
                    dept_code=data["dept_code"],
                    dept_name=data["dept_name"],
                    leader_id=item["leader_id"],
                    sort_order=int(data.get("sort_order") or 0),
                    status=int(data.get("status") or 1),
                )
                existing_code_ids[dept.dept_code] = dept.id
                success_count += 1
                progress = True
            if not progress:
                for item in next_pending:
                    errors.append({"line": item["line"], "message": f"上级部门编码 {item['data'].get('parent_code')} 未导入"})
                break
            pending = next_pending

        return {"success_count": success_count, "fail_count": len(errors), "errors": errors}

    async def _validate_payload(self, payload: dict[str, Any], dept_id: int = None, creating: bool = False) -> None:
        dept_code = payload.get("dept_code")
        dept_name = payload.get("dept_name")
        if creating and not str(dept_code or "").strip():
            raise ValidationError("部门编码不能为空")
        if dept_code is not None and not str(dept_code).strip():
            raise ValidationError("部门编码不能为空")
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
            if dept_id and parent_id in await self.repo.get_children_recursive(dept_id):
                raise ValidationError("父部门不能选择当前部门的下级部门")
        if dept_code:
            existing = await self.repo.get_by_code(str(dept_code).strip())
            if existing and existing.id != dept_id:
                raise ValidationError("部门编码已存在")
        leader_id = payload.get("leader_id")
        if leader_id and not await self.repo.get_employee_by_id(leader_id):
            raise ValidationError("负责人不存在")

    async def _ensure_import_codes_unique(self, rows: list[dict[str, str]]) -> None:
        codes: set[str] = set()
        for data in rows:
            code = data.get("dept_code") or ""
            if not code:
                continue
            if code in codes:
                raise ValidationError(f"CSV中部门编码 {code} 重复出现")
            if await self.repo.get_by_code(code):
                raise ValidationError(f"部门编码 {code} 在系统中已存在")
            codes.add(code)

    async def _get_existing_code_ids(self, rows: list[dict[str, str]]) -> dict[str, int]:
        code_ids: dict[str, int] = {"": 0}
        parent_codes = {row.get("parent_code") or "" for row in rows}
        for parent_code in parent_codes:
            if not parent_code:
                continue
            dept = await self.repo.get_by_code(parent_code)
            if dept:
                code_ids[parent_code] = dept.id
        return code_ids

    async def _validate_import_row(
        self,
        data: dict[str, str],
        existing_code_ids: dict[str, int],
        csv_codes: set[str],
        leader_cache: dict[str, int | None],
    ) -> list[str]:
        errors = []
        if not data.get("dept_code"):
            errors.append("dept_code不能为空")
        if not data.get("dept_name"):
            errors.append("dept_name不能为空")
        parent_code = data.get("parent_code") or ""
        if parent_code and parent_code not in existing_code_ids and parent_code not in csv_codes:
            errors.append(f"上级部门编码 {parent_code} 不存在")
        for field in ["sort_order"]:
            value = data.get(field)
            if value and not value.isdigit():
                errors.append(f"{field}只能为非负整数")
        status = data.get("status")
        if status and status not in {"0", "1"}:
            errors.append("status只能为0或1")
        leader_name = data.get("leader_name") or ""
        if leader_name and leader_name not in leader_cache:
            employee = await self.repo.get_employee_by_real_name(leader_name)
            leader_cache[leader_name] = employee.id if employee else None
        if leader_name and leader_cache[leader_name] is None:
            errors.append(f"负责人 {leader_name} 不存在")
        return errors

    def _normalize_item(self, item: dict[str, Any]) -> dict[str, Any]:
        return {**item, "parent_id": item.get("parent_id") or 0}
