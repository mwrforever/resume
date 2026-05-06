from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.deps import get_db
from app.deps import get_cache
from app.services.cache_service import CacheService
from app.services.user_service import UserManageService
from app.repositories.user_repository import UserRepository
from app.repositories.employee_repository import EmployeeRepository
from app.schemas.vo.request.account_management_request import ManagedUserCreate, ManagedUserUpdate
from app.schemas.vo.response.account_management_response import ApiResponse, ManagedUserItem, PageData

router = APIRouter()


def get_user_manage_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> UserManageService:
    return UserManageService(UserRepository(db), EmployeeRepository(db), cache)


@router.get("/users", response_model=ApiResponse[PageData])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    await service.ensure_admin(current_user)
    data = await service.list_users(page=page, page_size=page_size, status=status, search=search)
    return ApiResponse(data=PageData(**data))


@router.get("/users/{user_id}", response_model=ApiResponse[ManagedUserItem])
async def get_user(
    user_id: int,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(data=await service.get_user(user_id))


@router.post("/users", response_model=ApiResponse[ManagedUserItem])
async def create_user(
    body: ManagedUserCreate,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="创建成功", data=await service.create_user(body))


@router.put("/users/{user_id}", response_model=ApiResponse[ManagedUserItem])
async def update_user(
    user_id: int,
    body: ManagedUserUpdate,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="修改成功", data=await service.update_user(user_id, body))


@router.delete("/users/{user_id}", response_model=ApiResponse)
async def delete_user(
    user_id: int,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    await service.delete_user(user_id)
    return ApiResponse(message="删除成功")
