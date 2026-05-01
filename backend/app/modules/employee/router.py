from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.auth import AuthService
from app.infrastructure.client.deps import get_current_user
from app.infrastructure.client import get_db
from app.infrastructure.cache import get_cache, CacheService
from app.utils.security import create_access_token, create_refresh_token, decode_token, get_password_hash
from app.modules.employee.service import EmployeeManageService
from app.utils.verification import verify_and_consume_code
from app.modules.employee.repository import EmployeeRepository
from app.modules.dept.repository import DeptRepository
from app.modules.user.repository import UserRepository
from app.schemas.vo.request.auth_request import EmployeeLoginRequest, EmployeeRegisterRequest, RefreshTokenRequest
from app.schemas.vo.request.account_management_request import ManagedEmployeeCreate, ManagedEmployeeUpdate
from app.schemas.vo.response.auth_response import TokenResponse
from app.schemas.vo.response.account_management_response import ApiResponse, ManagedEmployeeItem, PageData

router = APIRouter()
employee_manage_router = APIRouter()


def get_auth_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> AuthService:
    return AuthService(UserRepository(db), EmployeeRepository(db), cache)


def get_employee_manage_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> EmployeeManageService:
    return EmployeeManageService(EmployeeRepository(db), DeptRepository(db), cache)


# ── auth endpoints ──

@router.post("/register")
async def register(
    req: EmployeeRegisterRequest,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    service: AuthService = Depends(get_auth_service)
) -> dict[str, Any]:
    await verify_and_consume_code(req.email, "employee", req.code, cache)

    employee_repo = EmployeeRepository(db)
    existing = await employee_repo.get_by_email(req.email)
    if existing:
        raise HTTPException(status_code=400, detail="该邮箱已被注册")
    existing_by_emp_no = await employee_repo.get_by_emp_no(req.emp_no)
    if existing_by_emp_no:
        raise HTTPException(status_code=400, detail="该员工号已被注册")

    employee = await employee_repo.create(
        emp_no=req.emp_no,
        email=req.email,
        password_hash=get_password_hash(req.password),
        real_name=req.real_name
    )
    access_token, refresh_token = service.create_tokens(employee.id, "employee")

    return {
        "code": 200,
        "message": "注册成功",
        "data": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user_type": "employee",
            "user_id": employee.id
        }
    }


@router.post("/login", response_model=TokenResponse)
async def login(
    req: EmployeeLoginRequest,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    service: AuthService = Depends(get_auth_service)
) -> TokenResponse:
    if req.login_type == "password":
        if not req.password:
            raise HTTPException(status_code=400, detail="密码不能为空")
        employee = await service.authenticate_employee(req.identifier, req.password)
        if not employee:
            raise HTTPException(status_code=401, detail="员工号/邮箱或密码错误")
    elif req.login_type == "code":
        if not req.code:
            raise HTTPException(status_code=400, detail="验证码不能为空")
        await verify_and_consume_code(req.identifier, "employee", req.code, cache)

        employee = await service.get_employee_by_email(req.identifier)
        if not employee:
            raise HTTPException(status_code=404, detail="员工不存在")
    else:
        raise HTTPException(status_code=400, detail="无效的登录类型")

    access_token, refresh_token = service.create_tokens(employee.id, "employee")
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_type="employee",
        user_id=employee.id
    )


@router.post("/refresh")
async def refresh_token(
    req: RefreshTokenRequest,
    service: AuthService = Depends(get_auth_service)
) -> dict[str, Any]:
    try:
        payload = decode_token(req.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="无效的refresh token")

        user_id = int(payload["sub"])
        user_type = payload.get("user_type", "employee")

        employee = await service.get_employee_by_id(user_id)
        if not employee or employee.status != 1:
            raise HTTPException(status_code=401, detail="员工已禁用")

        new_access_token = create_access_token({"sub": str(user_id), "type": "access", "user_type": user_type})
        new_refresh_token = create_refresh_token({"sub": str(user_id), "type": "refresh", "user_type": user_type})

        return {
            "code": 200,
            "message": "success",
            "data": {
                "access_token": new_access_token,
                "refresh_token": new_refresh_token
            }
        }
    except ValueError:
        raise HTTPException(status_code=401, detail="无效的token")


# ── employee management endpoints ──

@employee_manage_router.get("/employees", response_model=ApiResponse[PageData])
async def list_employees(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    service: EmployeeManageService = Depends(get_employee_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    await service.ensure_admin(current_user)
    data = await service.list_employees(page=page, page_size=page_size, status=status, search=search)
    return ApiResponse(data=PageData(**data))


@employee_manage_router.post("/employees/import", response_model=ApiResponse)
async def import_employees(
    file: UploadFile = File(...),
    service: EmployeeManageService = Depends(get_employee_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    content = await file.read()
    data = await service.import_employees(content)
    return ApiResponse(message="导入完成", data=data)


@employee_manage_router.get("/employees/{employee_id}", response_model=ApiResponse[ManagedEmployeeItem])
async def get_employee(
    employee_id: int,
    service: EmployeeManageService = Depends(get_employee_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedEmployeeItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(data=await service.get_employee(employee_id))


@employee_manage_router.post("/employees", response_model=ApiResponse[ManagedEmployeeItem])
async def create_employee(
    body: ManagedEmployeeCreate,
    service: EmployeeManageService = Depends(get_employee_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedEmployeeItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="创建成功", data=await service.create_employee(body))


@employee_manage_router.put("/employees/{employee_id}", response_model=ApiResponse[ManagedEmployeeItem])
async def update_employee(
    employee_id: int,
    body: ManagedEmployeeUpdate,
    service: EmployeeManageService = Depends(get_employee_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedEmployeeItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="修改成功", data=await service.update_employee(employee_id, body))


@employee_manage_router.delete("/employees/{employee_id}", response_model=ApiResponse)
async def delete_employee(
    employee_id: int,
    service: EmployeeManageService = Depends(get_employee_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    await service.delete_employee(employee_id, int(current_user["sub"]))
    return ApiResponse(message="删除成功")


__all__ = ["router", "employee_manage_router"]
