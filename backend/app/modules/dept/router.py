from typing import Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.modules.dept.repository import DeptRepository
from app.schemas.dept import DeptCreate, DeptImportResult, DeptItem, DeptUpdate
from app.schemas.response import ApiResponse, PageData
from app.modules.dept.service import DeptService

router = APIRouter()


def get_service(db: AsyncSession = Depends(get_db)) -> DeptService:
    return DeptService(DeptRepository(db))


@router.get("", response_model=ApiResponse)
async def list_depts(
    page: Optional[int] = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    if page is None:
        return ApiResponse(data=await service.list_active())
    data = await service.list_page(page=page, page_size=page_size, status=status, search=search)
    return ApiResponse(data=PageData(**data))


@router.get("/tree", response_model=ApiResponse)
async def get_dept_tree(
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    data = await service.get_tree()
    return ApiResponse(data=data)


@router.get("/leader-options", response_model=ApiResponse)
async def list_leader_options(
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    return ApiResponse(data=await service.list_leader_options())


@router.post("/import", response_model=ApiResponse[DeptImportResult])
async def import_depts(
    file: UploadFile = File(...),
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[DeptImportResult]:
    content = await file.read()
    data = await service.import_depts(content)
    return ApiResponse(message="导入完成", data=DeptImportResult(**data))


@router.get("/{dept_id}", response_model=ApiResponse[DeptItem])
async def get_dept(
    dept_id: int,
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[DeptItem]:
    return ApiResponse(data=await service.get_dept(dept_id))


@router.post("", response_model=ApiResponse[DeptItem])
async def create_dept(
    body: DeptCreate,
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[DeptItem]:
    return ApiResponse(message="创建成功", data=await service.create_dept(body))


@router.put("/{dept_id}", response_model=ApiResponse[DeptItem])
async def update_dept(
    dept_id: int,
    body: DeptUpdate,
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[DeptItem]:
    return ApiResponse(message="更新成功", data=await service.update_dept(dept_id, body))


@router.delete("/{dept_id}", response_model=ApiResponse)
async def delete_dept(
    dept_id: int,
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.delete_dept(dept_id)
    return ApiResponse(message="删除成功")

