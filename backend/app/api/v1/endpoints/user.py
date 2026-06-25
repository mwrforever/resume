from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.auth import AuthService
from app.deps import get_current_user
from app.deps import get_db
from app.deps import get_cache
from app.services.cache_service import CacheService
from app.core.security import create_access_token, create_refresh_token, decode_token, get_password_hash
from app.utils.verification import verify_and_consume_code
from app.repositories.user_repository import UserRepository
from app.repositories.employee_repository import EmployeeRepository
from app.schemas.vo.request.auth_request import LoginRequest, RefreshTokenRequest, RegisterRequest
from app.schemas.vo.response.auth_response import TokenResponse, RefreshTokenResponse
from app.schemas.vo.response.account_management_response import ApiResponse

router = APIRouter()


def get_auth_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> AuthService:
    return AuthService(UserRepository(db), EmployeeRepository(db), cache)


# ── auth endpoints ──

@router.post("/register")
async def register(
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    service: AuthService = Depends(get_auth_service)
) -> dict[str, Any]:
    await verify_and_consume_code(req.email, "user", req.code, cache)

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


@router.post("/login", response_model=ApiResponse[TokenResponse])
async def login(
    req: LoginRequest,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    service: AuthService = Depends(get_auth_service)
) -> ApiResponse[TokenResponse]:
    if req.login_type == "password":
        if not req.password:
            raise HTTPException(status_code=400, detail="密码不能为空")
        user = await service.authenticate_user(req.identifier, req.password)
        if not user:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    elif req.login_type == "code":
        if not req.code:
            raise HTTPException(status_code=400, detail="验证码不能为空")
        await verify_and_consume_code(req.identifier, "user", req.code, cache)

        user = await service.get_user_by_email(req.identifier)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
    else:
        raise HTTPException(status_code=400, detail="无效的登录类型")

    access_token, refresh_token = service.create_tokens(user["id"], "user")
    return ApiResponse(data=TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_type="user",
        user_id=user["id"]
    ))


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


@router.post("/refresh", response_model=ApiResponse[RefreshTokenResponse])
async def refresh_token(
    req: RefreshTokenRequest,
    service: AuthService = Depends(get_auth_service)
) -> ApiResponse[RefreshTokenResponse]:
    # 单独捕获 decode_token 的 ValueError，避免吞掉业务异常
    try:
        payload = decode_token(req.refresh_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="无效的token")
    # 以下逻辑中抛出的 HTTPException 由 FastAPI 统一处理，无需额外 try/except
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="无效的refresh token")

    user_id = int(payload["sub"])
    user_type = payload.get("user_type", "user")

    if user_type == "user":
        user = await service.get_user_by_id(user_id)
        if not user or user["status"] != 1:
            raise HTTPException(status_code=401, detail="用户已禁用")
    else:
        employee = await service.get_employee_by_id(user_id)
        if not employee or employee["status"] != 1:
            raise HTTPException(status_code=401, detail="员工已禁用")

    new_access_token = create_access_token({"sub": str(user_id), "type": "access", "user_type": user_type})
    new_refresh_token = create_refresh_token({"sub": str(user_id), "type": "refresh", "user_type": user_type})

    return ApiResponse(data=RefreshTokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        user_type=user_type,
        user_id=user_id
    ))