from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.models.job_application import JobApplication
from app.core.exceptions import NotFoundError, ValidationError


class ApplicationService:
    # 状态映射
    STATUS_MAP = {
        0: "待处理",
        1: "已查看",
        2: "评估完成",
        3: "面试邀请"
    }

    def __init__(self, app_repo: ApplicationRepository, resume_repo: ResumeRepository, job_repo: JobRepository):
        self.app_repo = app_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo

    async def create_application(self, user_id: int, job_id: int, resume_id: int) -> JobApplication:
        """创建投递记录"""
        # 验证岗位是否存在且在招聘中
        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")
        if job.status != 1:
            raise ValidationError("岗位已下架")

        # 验证简历是否属于当前用户
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume or resume.user_id != user_id:
            raise NotFoundError("简历不存在")

        return await self.app_repo.create(user_id, job_id, resume_id)

    async def get_user_applications(self, user_id: int, skip: int = 0, limit: int = 20) -> tuple[list, int]:
        """获取用户的投递列表"""
        apps = await self.app_repo.get_by_user(user_id, skip, limit)
        total = await self.app_repo.get_by_user_count(user_id)
        return apps, total

    async def get_application_by_id(self, app_id: int, user_id: int = None) -> JobApplication:
        """获取投递详情"""
        app = await self.app_repo.get_by_id(app_id)
        if not app:
            raise NotFoundError("投递记录不存在")
        if user_id and app.user_id != user_id:
            raise NotFoundError("投递记录不存在")
        return app

    async def get_job_applications(self, job_id: int, skip: int = 0, limit: int = 20) -> tuple[list, int]:
        """获取岗位的投递列表（员工端）"""
        apps = await self.app_repo.get_by_job(job_id, skip, limit)
        total = await self.app_repo.get_by_job_count(job_id)
        return apps, total

    async def update_status(self, app_id: int, status: int) -> bool:
        """更新投递状态"""
        return await self.app_repo.update_status(app_id, status)

    def get_status_name(self, status: int) -> str:
        return self.STATUS_MAP.get(status, "未知")