from typing import Any, Optional

import redis
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.auth import AuthService
from app.infrastructure.client.deps import get_current_user
from app.infrastructure.client import get_db
from app.utils.security import create_access_token, create_refresh_token, decode_token, get_password_hash
from app.infrastructure.client import get_redis_client
from app.modules.user.service import UserManageService
from app.utils.verification import verify_and_consume_code
from app.modules.user.repository import UserRepository
from app.modules.employee.repository import EmployeeRepository
from app.schemas.vo.request.auth_request import LoginRequest, RefreshTokenRequest, RegisterRequest
from app.schemas.vo.request.account_management_request import ManagedUserCreate, ManagedUserUpdate
from app.schemas.vo.response.auth_response import TokenResponse
from app.schemas.vo.response.account_management_response import ApiResponse, ManagedUserItem, PageData

router = APIRouter()
user_manage_router = APIRouter()


def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    return AuthService(UserRepository(db), EmployeeRepository(db))


def get_user_manage_service(db: AsyncSession = Depends(get_db)) -> UserManageService:
    return UserManageService(UserRepository(db), EmployeeRepository(db))


# ── auth endpoints ──

@router.post("/register")
async def register(
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    r: redis.Redis = Depends(get_redis_client),
    service: AuthService = Depends(get_auth_service)
) -> dict[str, Any]:
    verify_and_consume_code(req.email, "user", req.code, r)

    user_repo = UserRepository(db)
    existing = await user_repo.get_by_email(req.email)
    if existing:
        raise HTTPException(status_code=400, detail="邮箱已被注册")

    user = await user_repo.create(
        email=req.email,
        password_hash=get_password_hash(req.password),
        real_name=req.real_name
    )
    access_token, refresh_token = service.create_tokens(user.id, "user")

    return {
        "code": 200,
        "message": "注册成功",
        "data": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user_type": "user",
            "user_id": user.id
        }
    }


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    db: AsyncSession = Depends(get_db),
    r: redis.Redis = Depends(get_redis_client),
    service: AuthService = Depends(get_auth_service)
) -> TokenResponse:
    if req.login_type == "password":
        if not req.password:
            raise HTTPException(status_code=400, detail="密码不能为空")
        user = await service.authenticate_user(req.identifier, req.password)
        if not user:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    elif req.login_type == "code":
        if not req.code:
            raise HTTPException(status_code=400, detail="验证码不能为空")
        verify_and_consume_code(req.identifier, "user", req.code, r)

        user_repo = UserRepository(db)
        user = await user_repo.get_by_email(req.identifier)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
    else:
        raise HTTPException(status_code=400, detail="无效的登录类型")

    access_token, refresh_token = service.create_tokens(user.id, "user")
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_type="user",
        user_id=user.id
    )


@router.get("/me")
async def get_current_user_info(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
    user_repo = UserRepository(db)
    user = await user_repo.get_by_id(int(current_user["sub"]))
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": user.id,
            "email": user.email,
            "real_name": user.real_name,
            "create_time": user.create_time.isoformat() if user.create_time else None
        }
    }


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
        user_type = payload.get("user_type", "user")

        if user_type == "user":
            user = await service.get_user_by_id(user_id)
            if not user or user.status != 1:
                raise HTTPException(status_code=401, detail="用户已禁用")
        else:
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


# ── user management endpoints ──

@user_manage_router.get("/users", response_model=ApiResponse[PageData])
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


@user_manage_router.get("/users/{user_id}", response_model=ApiResponse[ManagedUserItem])
async def get_user(
    user_id: int,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(data=await service.get_user(user_id))


@user_manage_router.post("/users", response_model=ApiResponse[ManagedUserItem])
async def create_user(
    body: ManagedUserCreate,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="创建成功", data=await service.create_user(body))


@user_manage_router.put("/users/{user_id}", response_model=ApiResponse[ManagedUserItem])
async def update_user(
    user_id: int,
    body: ManagedUserUpdate,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[ManagedUserItem]:
    await service.ensure_admin(current_user)
    return ApiResponse(message="更新成功", data=await service.update_user(user_id, body))


@user_manage_router.delete("/users/{user_id}", response_model=ApiResponse)
async def delete_user(
    user_id: int,
    service: UserManageService = Depends(get_user_manage_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.ensure_admin(current_user)
    await service.delete_user(user_id)
    return ApiResponse(message="删除成功")


__all__ = ["router", "user_manage_router"]
