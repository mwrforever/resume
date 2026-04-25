import asyncio
from fastapi import APIRouter, Depends
from app.schemas.job import AiSuggestRequest, AiSuggestResponse, AiSuggestDimension, SkillSuggestItem
from app.api.deps import get_current_user
from app.schemas.response import ApiResponse
from app.utils.ai.chains import JobAiSuggestChain

router = APIRouter()

_chain = JobAiSuggestChain()


@router.post("/ai/suggest", response_model=ApiResponse[AiSuggestResponse])
async def ai_suggest(
    req: AiSuggestRequest,
    current_user: dict = Depends(get_current_user)
):
    """根据岗位名称和简要描述，AI生成：详细描述 + 评估维度 + 技能建议（不落库）"""
    result = await asyncio.to_thread(_chain.suggest, req.name, req.description or "")

    dimensions = [
        AiSuggestDimension(
            dimension_name=d.get("dimension_name", ""),
            weight=d.get("weight", 0.0),
            prompt_template=d.get("prompt_template", ""),
        )
        for d in result.get("dimensions", [])
        if d.get("dimension_name")
    ]

    skills = [
        SkillSuggestItem(
            skill=s.get("skill", ""),
            type=s.get("type", 3),
            reason=s.get("reason", ""),
        )
        for s in result.get("skills", [])
        if s.get("skill")
    ]

    return ApiResponse(data=AiSuggestResponse(
        comprehensive_description=result.get("comprehensive_description", ""),
        dimensions=dimensions,
        skills=skills,
    ))
