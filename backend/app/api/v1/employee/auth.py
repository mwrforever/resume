from fastapi import APIRouter, Depends, HTTPException
from app.schemas.auth import *
from app.services.auth_service import AuthService
from app.repositories.user_repo import UserRepository
from app.repositories.employee_repo import EmployeeRepository
from app.api.deps import get_db
import redis
import random

router = APIRouter()


def get_auth_service(db=Depends(get_db)) -> AuthService:
    return AuthService(UserRepository(db), EmployeeRepository(db))


def get_redis_client():
    return redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)


@router.post("/send-code")
async def send_code(req: SendCodeRequest):
    """员工发送验证码"""
    code = str(random.randint(100000, 999999))
    redis_client = get_redis_client()
    key = f"verify_code:{req.email}:employee"

    if redis_client.exists(f"{key}:cooldown"):
        raise HTTPException(status_code=429, detail="发送太频繁，请稍后再试")

    redis_client.setex(key, 300, code)
    redis_client.setex(f"{key}:cooldown", 60, "1")

    print(f"验证码: {code}")

    return {"code": 200, "message": "验证码已发送", "data": None}


@router.post("/login", response_model=TokenResponse)
async def login(req: EmployeeLoginRequest, service: AuthService = Depends(get_auth_service)):
    """员工登录 - 支持员工号/邮箱+密码 或 邮箱验证码"""
    if req.login_type == "password":
        if not req.password:
            raise HTTPException(status_code=400, detail="密码不能为空")
        employee = await service.authenticate_employee(req.identifier, req.password)
        if not employee:
            raise HTTPException(status_code=401, detail="员工号/邮箱或密码错误")
    elif req.login_type == "code":
        if not req.code:
            raise HTTPException(status_code=400, detail="验证码不能为空")
        redis_client = get_redis_client()
        key = f"verify_code:{req.identifier}:employee"
        stored_code = redis_client.get(key)

        if not stored_code or stored_code != req.code:
            raise HTTPException(status_code=400, detail="验证码错误或已过期")

        employee_repo = EmployeeRepository(await get_db().__anext__())
        employee = await employee_repo.get_by_email(req.identifier)
        if not employee:
            raise HTTPException(status_code=404, detail="员工不存在")

        redis_client.delete(key)
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
async def refresh_token(refresh_token: str):
    """刷新Token - 员工端"""
    from app.core.security import decode_token, create_access_token, create_refresh_token

    try:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="无效的refresh token")

        user_id = int(payload["sub"])

        service = AuthService(UserRepository(await get_db().__anext__()), EmployeeRepository(await get_db().__anext__()))
        employee = await service.get_employee_by_id(user_id)
        if not employee or employee.status != 1:
            raise HTTPException(status_code=401, detail="员工已禁用")

        new_access_token = create_access_token({"sub": str(user_id), "type": "employee"})
        new_refresh_token = create_refresh_token({"sub": str(user_id), "type": "employee"})

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
