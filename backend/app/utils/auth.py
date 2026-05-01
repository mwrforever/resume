from app.infrastructure.exception import ForbiddenError, UnauthorizedError
from app.infrastructure.cache import CacheService
from app.infrastructure.cache.redis_constants import (
    USER_KEY, USER_TTL,
    USER_EMAIL_KEY, USER_EMAIL_TTL,
    EMPLOYEE_KEY, EMPLOYEE_TTL,
    EMPLOYEE_EMAIL_KEY, EMPLOYEE_EMAIL_TTL,
    EMPLOYEE_EMP_NO_KEY, EMPLOYEE_EMP_NO_TTL,
)
from app.utils.security import create_access_token, create_refresh_token, verify_password

ADMIN_EMAIL = "18229923842@163.com"


class AuthService:
    def __init__(self, user_repo, employee_repo, cache: CacheService | None = None):
        self.user_repo = user_repo
        self.employee_repo = employee_repo
        self.cache = cache

    def _user_to_dict(self, user) -> dict:
        return {
            "id": user.id,
            "email": user.email,
            "real_name": user.real_name,
            "status": user.status,
        }

    def _employee_to_dict(self, emp) -> dict:
        return {
            "id": emp.id,
            "emp_no": emp.emp_no,
            "email": emp.email,
            "real_name": emp.real_name,
            "status": emp.status,
        }

    async def get_user_by_email(self, email: str):
        if self.cache:
            cached = await self.cache.get_json(USER_EMAIL_KEY.format(email=email))
            if cached is not None:
                return cached
        user = await self.user_repo.get_by_email(email)
        if self.cache and user:
            await self.cache.set_json(USER_EMAIL_KEY.format(email=email), self._user_to_dict(user), USER_EMAIL_TTL)
        return user

    async def get_user_by_id(self, user_id: int):
        if self.cache:
            cached = await self.cache.get_json(USER_KEY.format(user_id=user_id))
            if cached is not None:
                return cached
        user = await self.user_repo.get_by_id(user_id)
        if self.cache and user:
            await self.cache.set_json(USER_KEY.format(user_id=user_id), self._user_to_dict(user), USER_TTL)
        return user

    async def get_employee_by_email(self, email: str):
        if self.cache:
            cached = await self.cache.get_json(EMPLOYEE_EMAIL_KEY.format(email=email))
            if cached is not None:
                return cached
        employee = await self.employee_repo.get_by_email(email)
        if self.cache and employee:
            await self.cache.set_json(EMPLOYEE_EMAIL_KEY.format(email=email), self._employee_to_dict(employee), EMPLOYEE_EMAIL_TTL)
        return employee

    async def get_employee_by_emp_no(self, emp_no: str):
        if self.cache:
            cached = await self.cache.get_json(EMPLOYEE_EMP_NO_KEY.format(emp_no=emp_no))
            if cached is not None:
                return cached
        employee = await self.employee_repo.get_by_emp_no(emp_no)
        if self.cache and employee:
            await self.cache.set_json(EMPLOYEE_EMP_NO_KEY.format(emp_no=emp_no), self._employee_to_dict(employee), EMPLOYEE_EMP_NO_TTL)
        return employee

    async def get_employee_by_id(self, employee_id: int):
        if self.cache:
            cached = await self.cache.get_json(EMPLOYEE_KEY.format(employee_id=employee_id))
            if cached is not None:
                return cached
        employee = await self.employee_repo.get_by_id(employee_id)
        if self.cache and employee:
            await self.cache.set_json(EMPLOYEE_KEY.format(employee_id=employee_id), self._employee_to_dict(employee), EMPLOYEE_TTL)
        return employee

    async def authenticate_user(self, identifier: str, password: str):
        user = await self.user_repo.get_by_identifier(identifier)
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None
        if user.status != 1:
            raise UnauthorizedError("账号已被禁用")
        return user

    async def authenticate_employee(self, identifier: str, password: str):
        employee = await self.employee_repo.get_by_identifier(identifier)
        if not employee:
            return None
        if not employee.password_hash or not verify_password(password, employee.password_hash):
            return None
        if employee.status != 1:
            raise UnauthorizedError("账号已被禁用")
        return employee

    def create_tokens(self, user_id: int, user_type: str):
        access_token = create_access_token({"sub": str(user_id), "type": "access", "user_type": user_type})
        refresh_token = create_refresh_token({"sub": str(user_id), "type": "refresh", "user_type": user_type})
        return access_token, refresh_token


async def ensure_admin(current_user: dict, employee_repo) -> None:
    if current_user.get("user_type") != "employee":
        raise ForbiddenError("仅员工账号可访问")
    employee = await employee_repo.get_by_id(int(current_user["sub"]))
    if not employee or employee.email != ADMIN_EMAIL:
        raise ForbiddenError("当前员工无管理权限")
