from app.utils.auth import ensure_admin
from app.infrastructure.exception import NotFoundError, ValidationError
from app.utils.security import get_password_hash
from app.schemas.vo.response.account_management_response import ManagedUserItem


class UserManageService:
    def __init__(self, user_repo, employee_repo):
        self.user_repo = user_repo
        self.employee_repo = employee_repo

    async def ensure_admin(self, current_user: dict) -> None:
        await ensure_admin(current_user, self.employee_repo)

    async def list_users(self, page: int, page_size: int, status: int = None, search: str = None) -> dict:
        skip = (page - 1) * page_size
        users = await self.user_repo.list_page(skip=skip, limit=page_size, status=status, search=search)
        total = await self.user_repo.get_count(status=status, search=search)
        return {"total": total, "items": [ManagedUserItem.model_validate(user) for user in users]}

    async def get_user(self, user_id: int) -> ManagedUserItem:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        return ManagedUserItem.model_validate(user)

    async def create_user(self, body) -> ManagedUserItem:
        existing = await self.user_repo.get_by_email(str(body.email))
        if existing:
            raise ValidationError("该邮箱已存在")
        user = await self.user_repo.create(
            email=str(body.email),
            password_hash=get_password_hash(body.password),
            real_name=body.real_name,
        )
        if body.status != 1:
            user = await self.user_repo.update(user.id, status=body.status)
        return ManagedUserItem.model_validate(user)

    async def update_user(self, user_id: int, body) -> ManagedUserItem:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        payload = body.model_dump(exclude_unset=True)
        email = payload.get("email")
        if email and str(email) != user.email:
            existing = await self.user_repo.get_by_email(str(email))
            if existing:
                raise ValidationError("该邮箱已存在")
            payload["email"] = str(email)
        password = payload.pop("password", None)
        if password:
            payload["password_hash"] = get_password_hash(password)
        if payload:
            user = await self.user_repo.update(user_id, **payload)
        return ManagedUserItem.model_validate(user)

    async def delete_user(self, user_id: int) -> None:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        await self.user_repo.delete(user_id)
