from app.infrastructure.exception import ForbiddenError, UnauthorizedError
from app.utils.security import create_access_token, create_refresh_token, verify_password

ADMIN_EMAIL = "18229923842@163.com"


class AuthService:
    def __init__(self, user_repo, employee_repo):
        self.user_repo = user_repo
        self.employee_repo = employee_repo

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

    async def get_user_by_id(self, user_id: int):
        return await self.user_repo.get_by_id(user_id)

    async def get_employee_by_id(self, employee_id: int):
        return await self.employee_repo.get_by_id(employee_id)


async def ensure_admin(current_user: dict, employee_repo) -> None:
    if current_user.get("user_type") != "employee":
        raise ForbiddenError("仅员工账号可访问")
    employee = await employee_repo.get_by_id(int(current_user["sub"]))
    if not employee or employee.email != ADMIN_EMAIL:
        raise ForbiddenError("当前员工无管理权限")
