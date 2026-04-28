from fastapi import APIRouter, Depends, HTTPException
from app.schemas.auth import *
from app.services.auth_service import AuthService
from app.repositories.user_repo import UserRepository
from app.repositories.employee_repo import EmployeeRepository
from app.api.deps import get_db, get_current_user
from app.utils.email.email_service import send_verification_email
from sqlalchemy.ext.asyncio import AsyncSession
import redis
import random

router = APIRouter()


def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    return AuthService(UserRepository(db), EmployeeRepository(db))


def get_redis_client():
    from app.core.config import get_settings
    settings = get_settings()
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_DB,
        password=settings.redis_password or None,
        decode_responses=True
    )


@router.post("/send-code")
async def send_code(req: SendCodeRequest):
    """发送验证码到邮箱"""
    code = str(random.randint(100000, 999999))
    redis_client = get_redis_client()
    key = f"verify_code:{req.email}:{req.user_type}"

    # 60秒防刷
    if redis_client.exists(f"{key}:cooldown"):
        raise HTTPException(status_code=429, detail="发送太频繁，请稍后再试")

    # 存储验证码，5分钟有效
    redis_client.setex(key, 300, code)
    redis_client.setex(f"{key}:cooldown", 60, "1")

    # 发送邮件
    await send_verification_email(req.email, code)

    return {"code": 200, "message": "验证码已发送", "data": None}


@router.post("/register")
async def register(
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    service: AuthService = Depends(get_auth_service)
):
    """用户注册"""

    # 验证验证码
    redis_client = get_redis_client()
    key = f"verify_code:{req.email}:user"
    stored_code = redis_client.get(key)

    if not stored_code or stored_code != req.code:
        raise HTTPException(status_code=400, detail="验证码错误或已过期")

    # 检查用户是否存在
    user_repo = UserRepository(db)
    existing = await user_repo.get_by_email(req.email)
    if existing:
        raise HTTPException(status_code=400, detail="邮箱已被注册")

    # 创建用户
    from app.core.security import get_password_hash
    user = await user_repo.create(
        email=req.email,
        password_hash=get_password_hash(req.password),
        real_name=req.real_name
    )

    # 生成token
    access_token, refresh_token = service.create_tokens(user.id, "user")

    # 删除验证码
    redis_client.delete(key)

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
    service: AuthService = Depends(get_auth_service)
):
    """用户登录 - 支持用户名/邮箱+密码 或 邮箱验证码"""
    if req.login_type == "password":
        if not req.password:
            raise HTTPException(status_code=400, detail="密码不能为空")
        user = await service.authenticate_user(req.identifier, req.password)
        if not user:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
    elif req.login_type == "code":
        if not req.code:
            raise HTTPException(status_code=400, detail="验证码不能为空")
        # 验证验证码
        redis_client = get_redis_client()
        key = f"verify_code:{req.identifier}:user"
        stored_code = redis_client.get(key)

        if not stored_code or stored_code != req.code:
            raise HTTPException(status_code=400, detail="验证码错误或已过期")

        # 通过邮箱查找用户
        user_repo = UserRepository(db)
        user = await user_repo.get_by_email(req.identifier)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        redis_client.delete(key)
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
    current_user: dict = Depends(get_current_user)
):
    """获取当前用户信息"""
    from app.repositories.user_repo import UserRepository
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
    req: dict,
    db: AsyncSession = Depends(get_db),
    service: AuthService = Depends(get_auth_service)
):
    """刷新Token"""
    from app.core.security import decode_token, create_access_token, create_refresh_token

    refresh_token_val = req.get("refresh_token")
    if not refresh_token_val:
        raise HTTPException(status_code=400, detail="refresh_token不能为空")

    try:
        payload = decode_token(refresh_token_val)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="无效的refresh token")

        user_id = int(payload["sub"])
        user_type = payload.get("user_type", "user")

        # 验证用户仍然有效
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
