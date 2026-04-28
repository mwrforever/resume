from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.eval_dimension import EvalDimension
from app.models.eval_template import EvalTemplate
from app.models.eval_template_dimension import EvalTemplateDimension
from app.models.eval_template_skill import EvalTemplateSkill
from app.models.eval_template_tag import EvalTemplateTag
from app.models.job_position import JobPosition
from app.models.sys_tag import SysTag
from app.utils.ai.prompts import DIMENSION_EVAL_PROMPT


class EvalTemplateRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_dimensions(self, skip: int = 0, limit: int = 20, status: int = None, search: str = None) -> list[EvalDimension]:
        query = select(EvalDimension).where(EvalDimension.is_deleted == 0)
        if status is not None:
            query = query.where(EvalDimension.status == status)
        if search:
            query = query.where(EvalDimension.dimension_name.ilike(f"%{search}%"))
        query = query.order_by(EvalDimension.sort_order.asc(), EvalDimension.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def count_dimensions(self, status: int = None, search: str = None) -> int:
        query = select(func.count(EvalDimension.id)).where(EvalDimension.is_deleted == 0)
        if status is not None:
            query = query.where(EvalDimension.status == status)
        if search:
            query = query.where(EvalDimension.dimension_name.ilike(f"%{search}%"))
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_dimension(self, dimension_id: int) -> EvalDimension:
        result = await self.db.execute(
            select(EvalDimension).where(EvalDimension.id == dimension_id, EvalDimension.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def create_dimension(self, dimension_name: str, description: str, default_prompt_template: str, sort_order: int, status: int) -> EvalDimension:
        dimension = EvalDimension(
            dimension_name=dimension_name,
            description=description,
            default_prompt_template=default_prompt_template or DIMENSION_EVAL_PROMPT,
            sort_order=sort_order,
            status=status,
        )
        self.db.add(dimension)
        await self.db.commit()
        await self.db.refresh(dimension)
        return dimension

    async def update_dimension(self, dimension_id: int, **kwargs) -> EvalDimension:
        if "default_prompt_template" in kwargs and not kwargs["default_prompt_template"]:
            kwargs["default_prompt_template"] = DIMENSION_EVAL_PROMPT
        await self.db.execute(
            update(EvalDimension).where(EvalDimension.id == dimension_id, EvalDimension.is_deleted == 0).values(**kwargs)
        )
        await self.db.commit()
        return await self.get_dimension(dimension_id)

    async def delete_dimension(self, dimension_id: int) -> bool:
        await self.db.execute(
            update(EvalDimension).where(EvalDimension.id == dimension_id, EvalDimension.is_deleted == 0).values(is_deleted=1)
        )
        await self.db.commit()
        return True

    async def count_dimension_templates(self, dimension_id: int) -> int:
        result = await self.db.execute(
            select(func.count(EvalTemplateDimension.id)).where(EvalTemplateDimension.dimension_id == dimension_id)
        )
        return result.scalar() or 0

    async def count_dimension_published_jobs(self, dimension_id: int) -> int:
        result = await self.db.execute(
            select(func.count(JobPosition.id))
            .join(EvalTemplateDimension, EvalTemplateDimension.template_id == JobPosition.template_id)
            .where(
                EvalTemplateDimension.dimension_id == dimension_id,
                JobPosition.status == 1,
                JobPosition.is_deleted == 0,
            )
        )
        return result.scalar() or 0

    async def list_templates(self, skip: int = 0, limit: int = 20, status: int = None, search: str = None) -> list[EvalTemplate]:
        query = select(EvalTemplate).where(EvalTemplate.is_deleted == 0)
        if status is not None:
            query = query.where(EvalTemplate.status == status)
        if search:
            query = query.where(EvalTemplate.template_name.ilike(f"%{search}%"))
        query = query.order_by(EvalTemplate.id.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def count_templates(self, status: int = None, search: str = None) -> int:
        query = select(func.count(EvalTemplate.id)).where(EvalTemplate.is_deleted == 0)
        if status is not None:
            query = query.where(EvalTemplate.status == status)
        if search:
            query = query.where(EvalTemplate.template_name.ilike(f"%{search}%"))
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_template(self, template_id: int) -> EvalTemplate:
        result = await self.db.execute(
            select(EvalTemplate).where(EvalTemplate.id == template_id, EvalTemplate.is_deleted == 0)
        )
        return result.scalar_one_or_none()

    async def create_template(self, template_name: str, description: str, status: int) -> EvalTemplate:
        template = EvalTemplate(template_name=template_name, description=description, status=status)
        self.db.add(template)
        await self.db.flush()
        return template

    async def update_template(self, template_id: int, **kwargs) -> EvalTemplate:
        await self.db.execute(
            update(EvalTemplate).where(EvalTemplate.id == template_id, EvalTemplate.is_deleted == 0).values(**kwargs)
        )
        return await self.get_template(template_id)

    async def save_template_details(self, template_id: int, dimensions: list[dict], skills: list[dict], tag_ids: list[int]) -> None:
        await self.db.execute(delete(EvalTemplateDimension).where(EvalTemplateDimension.template_id == template_id))
        await self.db.execute(delete(EvalTemplateSkill).where(EvalTemplateSkill.template_id == template_id))
        await self.db.execute(delete(EvalTemplateTag).where(EvalTemplateTag.template_id == template_id))
        for idx, item in enumerate(dimensions):
            dimension = await self.get_dimension(int(item["dimension_id"]))
            self.db.add(EvalTemplateDimension(
                template_id=template_id,
                dimension_id=item["dimension_id"],
                weight=item["weight"],
                prompt_template=item.get("prompt_template") or (dimension.default_prompt_template if dimension else DIMENSION_EVAL_PROMPT),
                sort_order=item.get("sort_order", idx),
            ))
        for item in skills:
            self.db.add(EvalTemplateSkill(
                template_id=template_id,
                skill_name=item["skill_name"],
                skill_type=item["skill_type"],
                match_label=item.get("match_label"),
                is_ai_generated=item.get("is_ai_generated", 0),
            ))
        for tag_id in tag_ids:
            self.db.add(EvalTemplateTag(template_id=template_id, tag_id=tag_id))

    async def create_template_with_details(self, template_name: str, description: str, status: int, dimensions: list[dict], skills: list[dict], tag_ids: list[int]) -> EvalTemplate:
        template = await self.create_template(template_name, description, status)
        await self.save_template_details(template.id, dimensions, skills, tag_ids)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def update_template_with_details(self, template_id: int, payload: dict, dimensions: list[dict] = None, skills: list[dict] = None, tag_ids: list[int] = None) -> EvalTemplate:
        if payload:
            await self.update_template(template_id, **payload)
        if dimensions is not None or skills is not None or tag_ids is not None:
            current = await self.get_template_detail(template_id)
            await self.save_template_details(
                template_id,
                dimensions if dimensions is not None else current["dimensions"],
                skills if skills is not None else current["skills"],
                tag_ids if tag_ids is not None else [tag["id"] for tag in current["tags"]],
            )
        await self.db.commit()
        return await self.get_template(template_id)

    async def delete_template(self, template_id: int) -> bool:
        await self.db.execute(
            update(EvalTemplate).where(EvalTemplate.id == template_id, EvalTemplate.is_deleted == 0).values(is_deleted=1)
        )
        await self.db.commit()
        return True

    async def count_template_jobs(self, template_id: int, status: int = None) -> int:
        query = select(func.count(JobPosition.id)).where(JobPosition.template_id == template_id, JobPosition.is_deleted == 0)
        if status is not None:
            query = query.where(JobPosition.status == status)
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def get_template_detail(self, template_id: int) -> dict:
        template = await self.get_template(template_id)
        if not template:
            return {}
        dimension_rows = await self.db.execute(
            select(EvalTemplateDimension, EvalDimension.dimension_name)
            .join(EvalDimension, EvalDimension.id == EvalTemplateDimension.dimension_id)
            .where(EvalTemplateDimension.template_id == template_id, EvalDimension.is_deleted == 0, EvalDimension.status == 1)
            .order_by(EvalTemplateDimension.sort_order.asc(), EvalTemplateDimension.id.asc())
        )
        skill_rows = await self.db.execute(
            select(EvalTemplateSkill)
            .where(EvalTemplateSkill.template_id == template_id)
            .order_by(EvalTemplateSkill.skill_type.asc(), EvalTemplateSkill.id.asc())
        )
        tag_rows = await self.db.execute(
            select(SysTag)
            .join(EvalTemplateTag, EvalTemplateTag.tag_id == SysTag.id)
            .where(EvalTemplateTag.template_id == template_id, SysTag.is_deleted == 0, SysTag.status == 1)
            .order_by(SysTag.sort_order.asc(), SysTag.id.asc())
        )
        dimensions = [
            {
                "id": row[0].id,
                "dimension_id": row[0].dimension_id,
                "dimension_name": row[1],
                "weight": float(row[0].weight),
                "prompt_template": row[0].prompt_template,
                "sort_order": row[0].sort_order,
            }
            for row in dimension_rows.all()
        ]
        skills = [
            {
                "id": item.id,
                "skill_name": item.skill_name,
                "skill_type": item.skill_type,
                "match_label": item.match_label,
                "is_ai_generated": item.is_ai_generated,
            }
            for item in skill_rows.scalars().all()
        ]
        tags = [
            {
                "id": item.id,
                "tag_name": item.tag_name,
                "tag_type": item.tag_type,
                "color": item.color,
            }
            for item in tag_rows.scalars().all()
        ]
        return {
            "id": template.id,
            "template_name": template.template_name,
            "description": template.description,
            "status": template.status,
            "dimensions": dimensions,
            "skills": skills,
            "tags": tags,
        }
