from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.schemas.job import SkillSuggestRequest, SkillSuggestItem
from app.api.deps import get_current_user
from typing import List

router = APIRouter()


@router.post("/suggest", response_model=List[SkillSuggestItem])
async def suggest_skills(
    req: SkillSuggestRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    AI生成岗位技能建议（仅返回前端，不落库）

    员工发布岗位时输入岗位名称和描述，系统调用AI生成技能列表建议，
    员工确认后再手动添加技能到岗位。
    """
    # TODO: 实现LiteLLM技能建议
    # 目前返回模拟数据
    return [
        {"skill": "React", "type": 1, "reason": "核心框架，必须掌握"},
        {"skill": "TypeScript", "type": 2, "reason": "提升代码质量和可维护性"},
        {"skill": "Node.js", "type": 3, "reason": "后端技术栈补充"},
        {"skill": "Git", "type": 3, "reason": "版本控制和协作开发"},
        {"skill": "CSS/Tailwind", "type": 2, "reason": "样式和UI开发"},
    ]
