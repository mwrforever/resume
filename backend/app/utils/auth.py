from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.services.cache_service import CacheService
from app.utils.cache_utils import (
    USER_KEY, USER_TTL,
    USER_EMAIL_KEY, USER_EMAIL_TTL,
    EMPLOYEE_KEY, EMPLOYEE_TTL,
    EMPLOYEE_EMAIL_KEY, EMPLOYEE_EMAIL_TTL,
    EMPLOYEE_EMP_NO_KEY, EMPLOYEE_EMP_NO_TTL,
)
from app.core.security import create_access_token, create_refresh_token, verify_password


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
            "is_admin": getattr(emp, "is_admin", 0) or 0,
        }

    async def get_user_by_email(self, email: str) -> dict | None:
        """按邮箱取用户，统一返回 dict 形态（无缓存时也 ORM→dict 转换）。

        归一化的目的：避免缓存命中/未命中两条路径返回不同类型，调用方做属性访问时
        在缓存命中分支炸 AttributeError。
        """
        if self.cache:
            cached = await self.cache.get_json(USER_EMAIL_KEY.format(email=email))
            if cached is not None:
                return cached
        user = await self.user_repo.get_by_email(email)
        if not user:
            return None
        user_dict = self._user_to_dict(user)
        if self.cache:
            await self.cache.set_json(USER_EMAIL_KEY.format(email=email), user_dict, USER_EMAIL_TTL)
        return user_dict

    async def get_user_by_id(self, user_id: int) -> dict | None:
        if self.cache:
            cached = await self.cache.get_json(USER_KEY.format(user_id=user_id))
            if cached is not None:
                return cached
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            return None
        user_dict = self._user_to_dict(user)
        if self.cache:
            await self.cache.set_json(USER_KEY.format(user_id=user_id), user_dict, USER_TTL)
        return user_dict

    async def get_employee_by_email(self, email: str) -> dict | None:
        if self.cache:
            cached = await self.cache.get_json(EMPLOYEE_EMAIL_KEY.format(email=email))
            if cached is not None:
                return cached
        employee = await self.employee_repo.get_by_email(email)
        if not employee:
            return None
        employee_dict = self._employee_to_dict(employee)
        if self.cache:
            await self.cache.set_json(EMPLOYEE_EMAIL_KEY.format(email=email), employee_dict, EMPLOYEE_EMAIL_TTL)
        return employee_dict

    async def get_employee_by_emp_no(self, emp_no: str) -> dict | None:
        if self.cache:
            cached = await self.cache.get_json(EMPLOYEE_EMP_NO_KEY.format(emp_no=emp_no))
            if cached is not None:
                return cached
        employee = await self.employee_repo.get_by_emp_no(emp_no)
        if not employee:
            return None
        employee_dict = self._employee_to_dict(employee)
        if self.cache:
            await self.cache.set_json(EMPLOYEE_EMP_NO_KEY.format(emp_no=emp_no), employee_dict, EMPLOYEE_EMP_NO_TTL)
        return employee_dict

    async def get_employee_by_id(self, employee_id: int) -> dict | None:
        if self.cache:
            cached = await self.cache.get_json(EMPLOYEE_KEY.format(employee_id=employee_id))
            if cached is not None:
                return cached
        employee = await self.employee_repo.get_by_id(employee_id)
        if not employee:
            return None
        employee_dict = self._employee_to_dict(employee)
        if self.cache:
            await self.cache.set_json(EMPLOYEE_KEY.format(employee_id=employee_id), employee_dict, EMPLOYEE_TTL)
        return employee_dict

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:
        # 与 get_user_by_* 保持同一形态：统一返回 dict，endpoint 端按下标访问不再炸
        user = await self.user_repo.get_by_identifier(identifier)
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None
        if user.status != 1:
            raise UnauthorizedError("账号已被禁用")
        return self._user_to_dict(user)

    async def authenticate_employee(self, identifier: str, password: str) -> dict | None:
        # 与 get_employee_by_* 保持同一形态：统一返回 dict，避免 ORM 下标访问报错
        employee = await self.employee_repo.get_by_identifier(identifier)
        if not employee:
            return None
        if not employee.password_hash or not verify_password(password, employee.password_hash):
            return None
        if employee.status != 1:
            raise UnauthorizedError("账号已被禁用")
        return self._employee_to_dict(employee)

    def create_tokens(self, user_id: int, user_type: str):
        access_token = create_access_token({"sub": str(user_id), "type": "access", "user_type": user_type})
        refresh_token = create_refresh_token({"sub": str(user_id), "type": "refresh", "user_type": user_type})
        return access_token, refresh_token


async def ensure_admin(current_user: dict, employee_repo) -> None:
    """校验当前用户是否为员工管理员（is_admin=1）。

    管理员身份由 sys_employee.is_admin 字段判定，替代旧版写死邮箱的方式，
    支持在员工管理页动态授权/回收。非员工或非管理员一律拒绝。
    """
    if current_user.get("user_type") != "employee":
        raise ForbiddenError("仅员工账号可访问")
    employee = await employee_repo.get_by_id(int(current_user["sub"]))
    # is_admin 为 1 才放行；旧数据缺列时 getattr 兜底为 0（拒绝）
    if not employee or not is_employee_admin(employee):
        raise ForbiddenError("当前员工无管理权限")


def is_employee_admin(employee) -> bool:
    """统一读取员工管理员标记。

    AuthService 的 get_by_* 在缓存命中时返回 dict、未命中返回 ORM 对象，
    两种形态都兼容，避免缓存路径下 is_admin 误判为 False。供需要"判定而非抛错"
    的调用方（如模型配置权限）使用，ensure_admin 内部也复用本函数。
    """
    if employee is None:
        return False
    if isinstance(employee, dict):
        return bool(employee.get("is_admin", 0))
    return bool(getattr(employee, "is_admin", 0) or 0)
