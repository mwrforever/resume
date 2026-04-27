from typing import Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.repositories.dept_repo import DeptRepository
from app.repositories.employee_repo import EmployeeRepository
from app.repositories.user_repo import UserRepository
from app.schemas.account_management import (
    ManagedEmployeeCreate,
    ManagedEmployeeItem,
    ManagedEmployeeUpdate,
    ManagedUserCreate,
    ManagedUserItem,
    ManagedUserUpdate,
)
from app.schemas.response import ApiResponse, PageData
from app.services.account_management_service import AccountManagementService

router = APIRouter()


def get_service(db: AsyncSession = Depends(get_db)) -> AccountManagementService:
    return AccountManagementService(UserRepository(db), EmployeeRepository(db), DeptRepository(db))


@router.get("/users", response_model=ApiResponse[PageData])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    await service.ensure_admin(current_user)
    data = await service.list_users(page=page, page_size=page_size, status=status, search=search)
    return ApiResponse(data=PageData(**data))


@router.get("/users/{user_id}", response_model=ApiResponse[ManagedUserItem])
async def get_user(
    user_id: int,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(data=await service.get_user(user_id))


@router.post("/users", response_model=ApiResponse[ManagedUserItem])
async def create_user(
    body: ManagedUserCreate,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="创建成功", data=await service.create_user(body))


@router.put("/users/{user_id}", response_model=ApiResponse[ManagedUserItem])
async def update_user(
    user_id: int,
    body: ManagedUserUpdate,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="更新成功", data=await service.update_user(user_id, body))


@router.delete("/users/{user_id}", response_model=ApiResponse)
async def delete_user(
    user_id: int,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    await service.delete_user(user_id)
    return ApiResponse(message="删除成功")


@router.get("/employees", response_model=ApiResponse[PageData])
async def list_employees(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    await service.ensure_admin(current_user)
    data = await service.list_employees(page=page, page_size=page_size, status=status, search=search)
    return ApiResponse(data=PageData(**data))


@router.post("/employees/import", response_model=ApiResponse)
async def import_employees(
    file: UploadFile = File(...),
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    content = await file.read()
    data = await service.import_employees(content)
    return ApiResponse(message="导入完成", data=data)


@router.get("/employees/{employee_id}", response_model=ApiResponse[ManagedEmployeeItem])
async def get_employee(
    employee_id: int,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedEmployeeItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(data=await service.get_employee(employee_id))


@router.post("/employees", response_model=ApiResponse[ManagedEmployeeItem])
async def create_employee(
    body: ManagedEmployeeCreate,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedEmployeeItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="创建成功", data=await service.create_employee(body))


@router.put("/employees/{employee_id}", response_model=ApiResponse[ManagedEmployeeItem])
async def update_employee(
    employee_id: int,
    body: ManagedEmployeeUpdate,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedEmployeeItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="更新成功", data=await service.update_employee(employee_id, body))


@router.delete("/employees/{employee_id}", response_model=ApiResponse)
async def delete_employee(
    employee_id: int,
    service: AccountManagementService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    await service.delete_employee(employee_id, int(current_user["sub"]))
    return ApiResponse(message="删除成功")
