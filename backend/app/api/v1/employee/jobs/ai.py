import asyncio

from fastapi import APIRouter

from app.schemas.job import AiSuggestRequest, AiSuggestResponse
from app.schemas.response import ApiResponse
from app.utils.ai.chains import JobAiSuggestChain

router = APIRouter()

_chain = JobAiSuggestChain()


@router.post("/ai/suggest", response_model=ApiResponse[AiSuggestResponse])
async def ai_suggest(
    req: AiSuggestRequest,
):
    """根据岗位名称和已有描述，AI润色生成更详细的岗位描述（不落库）"""
    result = await asyncio.to_thread(_chain.suggest, req.name, req.description or "")

    return ApiResponse(data=AiSuggestResponse(
        comprehensive_description=result.get("comprehensive_description", ""),
        dimensions=[],
        skills=[],
    ))
