from datetime import datetime

from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.eval_template_repo import EvalTemplateRepository


class EvalTemplateService:
    def __init__(self, repo: EvalTemplateRepository):
        self.repo = repo

    async def ensure_template_unlocked(self, template_id: int) -> None:
        if await self.repo.count_template_jobs(template_id, status=1) > 0:
            raise ValidationError("已有招聘中岗位绑定该模板，不允许修改")

    def validate_template_detail(self, dimensions: list[dict]) -> None:
        if not dimensions:
            raise ValidationError("评估模板至少需要一个评估维度")
        total_weight = round(sum(float(item.get("weight") or 0) for item in dimensions), 2)
        if abs(total_weight - 1.0) > 0.01:
            raise ValidationError("评估维度权重合计必须为1.00")

    async def validate_template_available(self, template_id: int) -> dict:
        detail = await self.repo.get_template_detail(template_id)
        if not detail:
            raise NotFoundError("评估模板不存在")
        if detail["status"] != 1:
            raise ValidationError("评估模板已停用")
        self.validate_template_detail(detail["dimensions"])
        return detail

    async def create_dimension(self, body) -> object:
        return await self.repo.create_dimension(
            dimension_name=body.dimension_name,
            description=body.description,
            default_prompt_template=body.default_prompt_template,
            sort_order=body.sort_order,
            status=body.status,
        )

    async def update_dimension(self, dimension_id: int, body) -> object:
        dimension = await self.repo.get_dimension(dimension_id)
        if not dimension:
            raise NotFoundError("评估维度不存在")
        if await self.repo.count_dimension_published_jobs(dimension_id) > 0:
            raise ValidationError("已有招聘中岗位的模板引用该维度，不允许修改")
        payload = body.model_dump(exclude_unset=True)
        return await self.repo.update_dimension(dimension_id, **payload) if payload else dimension

    async def delete_dimension(self, dimension_id: int) -> bool:
        dimension = await self.repo.get_dimension(dimension_id)
        if not dimension:
            raise NotFoundError("评估维度不存在")
        if await self.repo.count_dimension_templates(dimension_id) > 0:
            raise ValidationError("已有评估模板引用该维度，不允许删除")
        return await self.repo.delete_dimension(dimension_id)

    async def create_template(self, body) -> object:
        dimensions = [item.model_dump() for item in body.dimensions]
        self.validate_template_detail(dimensions)
        return await self.repo.create_template_with_details(
            template_name=body.template_name,
            description=body.description,
            status=body.status,
            dimensions=dimensions,
            skills=[item.model_dump() for item in body.skills],
            tag_ids=body.tag_ids,
        )

    async def update_template(self, template_id: int, body) -> object:
        template = await self.repo.get_template(template_id)
        if not template:
            raise NotFoundError("评估模板不存在")
        await self.ensure_template_unlocked(template_id)
        payload = body.model_dump(exclude_unset=True)
        dimensions = payload.pop("dimensions", None)
        skills = payload.pop("skills", None)
        tag_ids = payload.pop("tag_ids", None)
        if dimensions is not None:
            self.validate_template_detail(dimensions)
        return await self.repo.update_template_with_details(template_id, payload, dimensions, skills, tag_ids)

    async def delete_template(self, template_id: int) -> bool:
        template = await self.repo.get_template(template_id)
        if not template:
            raise NotFoundError("评估模板不存在")
        await self.ensure_template_unlocked(template_id)
        if await self.repo.count_template_jobs(template_id) > 0:
            raise ValidationError("已有岗位绑定该模板，不允许删除")
        return await self.repo.delete_template(template_id)

    async def build_job_snapshot(self, job, template_detail: dict, dept_name: str = None, dept_code: str = None) -> dict:
        return {
            "job": {
                "id": job.id,
                "name": job.name,
                "description": job.description or "",
                "dept_id": job.dept_id,
                "dept_name": dept_name,
                "dept_code": dept_code,
            },
            "template": {
                "id": template_detail["id"],
                "template_name": template_detail["template_name"],
            },
            "dimensions": template_detail["dimensions"],
            "skills": template_detail["skills"],
            "tags": template_detail["tags"],
            "snapshot_time": datetime.now().isoformat(timespec="seconds"),
        }
