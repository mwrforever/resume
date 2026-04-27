import asyncio
from datetime import datetime

from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.eval_template_repo import EvalTemplateRepository
from app.schemas.eval_template import EvalDimensionAiSuggestRequest, JobTemplateAiSuggestRequest, TemplateSkillAiSuggestRequest
from app.utils.ai.chains import EvalDimensionAiSuggestChain, JobTemplateAiSuggestChain, TemplateSkillAiSuggestChain


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

    async def suggest_dimension(self, body: EvalDimensionAiSuggestRequest) -> dict[str, str]:
        result = await asyncio.to_thread(
            EvalDimensionAiSuggestChain().suggest,
            body.job_name,
            body.job_description or "",
        )
        if not result.get("dimension_name"):
            raise ValidationError("AI 未返回维度建议，请补充岗位信息后重试")
        return result

    async def suggest_template_skills(self, body: TemplateSkillAiSuggestRequest) -> dict:
        dimensions = [item.model_dump() for item in body.dimensions if item.dimension_name.strip()]
        if not dimensions:
            raise ValidationError("请先选择评估维度")
        result = await asyncio.to_thread(TemplateSkillAiSuggestChain().suggest, dimensions)
        skills = []
        for item in result.get("skills", []):
            skill_name = str(item.get("skill_name") or "").strip()
            if not skill_name:
                continue
            skill_type = item.get("skill_type") if item.get("skill_type") in [1, 2, 3] else 3
            skills.append({
                "skill_name": skill_name,
                "skill_type": skill_type,
                "match_label": str(item.get("match_label") or "").strip() or None,
                "is_ai_generated": 1,
            })
        if not skills:
            raise ValidationError("AI 未返回技能建议，请调整维度后重试")
        return {"skills": skills}

    async def suggest_job_template(self, body: JobTemplateAiSuggestRequest) -> dict:
        if not body.job_name.strip():
            raise ValidationError("请先填写岗位名称")
        result = await asyncio.to_thread(
            JobTemplateAiSuggestChain().suggest,
            body.job_name,
            body.job_description or "",
        )
        dimensions = []
        for item in result.get("dimensions", []):
            dimension_name = str(item.get("dimension_name") or "").strip()
            if not dimension_name:
                continue
            dimensions.append({
                "dimension_name": dimension_name,
                "description": str(item.get("description") or "").strip(),
                "weight": float(item.get("weight") or 0),
                "prompt_template": str(item.get("prompt_template") or "").strip(),
            })
        self.validate_template_detail(dimensions)
        skills = []
        for item in result.get("skills", []):
            skill_name = str(item.get("skill_name") or item.get("skill") or "").strip()
            if not skill_name:
                continue
            skill_type = item.get("skill_type") if item.get("skill_type") in [1, 2, 3] else item.get("type")
            skill_type = skill_type if skill_type in [1, 2, 3] else 3
            skills.append({
                "skill_name": skill_name,
                "skill_type": skill_type,
                "match_label": str(item.get("match_label") or item.get("reason") or "").strip() or None,
                "is_ai_generated": 1,
            })
        if not result.get("template_name"):
            raise ValidationError("AI 未返回模板建议，请补充岗位信息后重试")
        if not skills:
            raise ValidationError("AI 未返回技能建议，请补充岗位信息后重试")
        return {
            "template_name": result.get("template_name"),
            "description": result.get("description") or "",
            "dimensions": dimensions,
            "skills": skills,
        }

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
