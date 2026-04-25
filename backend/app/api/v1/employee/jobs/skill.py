import asyncio
from fastapi import APIRouter, Depends
from app.schemas.job import SkillSuggestRequest, SkillSuggestItem, SkillCreate, SkillItem
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse
from typing import List

router = APIRouter()


def get_repo(db=Depends(get_db)) -> JobRepository:
    return JobRepository(db)


@router.post("/skill/suggest", response_model=List[SkillSuggestItem])
async def suggest_skills(
    req: SkillSuggestRequest,
    current_user: dict = Depends(get_current_user)
):
    """AI生成岗位技能建议（仅返回前端，不落库）"""
    from app.utils.ai.prompts import SKILL_SUGGEST_PROMPT
    from app.utils.ai.client import llm_complete
    import json, re

    prompt = SKILL_SUGGEST_PROMPT.format(job_name=req.name, job_description=req.description or "")
    raw = await asyncio.to_thread(llm_complete, prompt)
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        try:
            items = json.loads(match.group())
            return [SkillSuggestItem(skill=i["skill"], type=i["type"], reason=i.get("reason", "")) for i in items if "skill" in i and "type" in i]
        except (json.JSONDecodeError, KeyError):
            pass
    return []


@router.get("/{job_id}/skills", response_model=ApiResponse[List[SkillItem]])
async def list_skills(
    job_id: int,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    skills = await repo.get_job_skills(job_id)
    return ApiResponse(data=[SkillItem.model_validate(s) for s in skills])


@router.post("/{job_id}/skills", response_model=ApiResponse[SkillItem])
async def add_skill(
    job_id: int,
    body: SkillCreate,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    skill = await repo.add_skill(
        job_id=job_id,
        skill_name=body.skill_name,
        skill_type=body.skill_type,
        match_label=body.match_label,
    )
    return ApiResponse(data=SkillItem.model_validate(skill))


@router.delete("/{job_id}/skills/{skill_id}", response_model=ApiResponse)
async def delete_skill(
    job_id: int,
    skill_id: int,
    repo: JobRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    await repo.delete_skill(skill_id)
    return ApiResponse(message="删除成功")
