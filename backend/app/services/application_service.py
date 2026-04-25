from app.repositories.application_repo import ApplicationRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.models.job_application import JobApplication
from app.core.exceptions import NotFoundError, ValidationError


class ApplicationService:
    # 状态映射
    STATUS_MAP = {
        0: "待评估",
        1: "待处理",
        2: "已查看",
        3: "面试中",
        4: "已拒绝",
        5: "已录用",
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

    async def get_user_application_for_job(self, user_id: int, job_id: int) -> JobApplication:
        """获取用户对某岗位的投递记录"""
        return await self.app_repo.get_by_user_and_job(user_id, job_id)

    async def get_resume_by_id(self, resume_id: int):
        """获取简历详情"""
        return await self.resume_repo.get_by_id(resume_id)

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

    async def get_job_name(self, job_id: int) -> str:
        """获取岗位名称"""
        job = await self.job_repo.get_by_id(job_id)
        return job.name if job else ""

    async def get_job_names(self, job_ids: list[int]) -> dict[int, str]:
        """批量获取岗位名称"""
        result = {}
        for job_id in job_ids:
            job = await self.job_repo.get_by_id(job_id)
            if job:
                result[job_id] = job.name
        return result

    async def update_status(self, app_id: int, status: int) -> bool:
        """更新投递状态"""
        return await self.app_repo.update_status(app_id, status)

    async def withdraw_application(self, app_id: int, user_id: int) -> bool:
        """撤回投递（仅限待评估或待处理状态的投递）"""
        app = await self.app_repo.get_by_id(app_id)
        if not app or app.is_deleted == 1:
            raise NotFoundError("投递记录不存在")
        if app.user_id != user_id:
            raise NotFoundError("投递记录不存在")
        if app.status not in (0, 1):
            raise ValidationError("只能撤回待评估或待处理状态的投递")
        return await self.app_repo.soft_delete(app_id)

    def get_status_name(self, status: int) -> str:
        return self.STATUS_MAP.get(status, "未知")