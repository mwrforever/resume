from fastapi import APIRouter, Depends
from sqlalchemy import select
from app.api.deps import get_db, get_current_user
from app.models.sys_dept import SysDept
from app.schemas.response import ApiResponse

router = APIRouter()


@router.get("", response_model=ApiResponse)
async def list_depts(
    db=Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """员工端：获取部门列表（用于岗位发布时选择）"""
    result = await db.execute(
        select(SysDept)
        .where(SysDept.is_deleted == 0, SysDept.status == 1)
        .order_by(SysDept.sort_order.asc(), SysDept.id.asc())
    )
    depts = result.scalars().all()
    return ApiResponse(data=[
        {"id": d.id, "dept_name": d.dept_name, "dept_code": d.dept_code}
        for d in depts
    ])
