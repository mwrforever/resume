import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from app.config.settings import Settings
from app.core.exceptions import register_exception_handlers
from app.modules.account_management.router import router as account_management_router
from app.modules.analytics.router import router as analytics_router
from app.modules.application.router import employee_router as employee_applications_router
from app.modules.application.router import user_router as user_applications_router
from app.modules.dept.router import router as depts_router
from app.modules.employee_auth.router import router as employee_auth_router
from app.modules.eval_template.router import dimension_router as eval_dimensions_router
from app.modules.eval_template.router import template_router as eval_templates_router
from app.modules.evaluation.router import router as evaluations_router
from app.modules.job.router import employee_ai_router as job_ai_router
from app.modules.job.router import employee_router as employee_jobs_router
from app.modules.job.router import user_router as user_jobs_router
from app.modules.resume.router import employee_router as employee_resumes_router
from app.modules.resume.router import user_router as user_resumes_router
from app.modules.system.router import create_system_router
from app.modules.tag.router import router as tags_router
from app.modules.user_auth.router import router as user_auth_router


class ApplicationContainer:
    instance_strategy = "Scoped"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def create_app(self) -> FastAPI:
        app = FastAPI(title=self.settings.APP_NAME)
        self._register_middleware(app)
        register_exception_handlers(app)
        self._register_routers(app)
        self._mount_static_files(app)
        return app

    def _register_middleware(self, app: FastAPI) -> None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def _register_routers(self, app: FastAPI) -> None:
        app.include_router(user_auth_router, prefix="/api/v1/user/auth", tags=["user-auth"])
        app.include_router(employee_auth_router, prefix="/api/v1/employee/auth", tags=["employee-auth"])
        app.include_router(user_resumes_router, prefix="/api/v1/user/resumes", tags=["user-resumes"])
        app.include_router(user_jobs_router, prefix="/api/v1/user/jobs", tags=["user-jobs"])
        app.include_router(user_applications_router, prefix="/api/v1/user/applications", tags=["user-applications"])
        app.include_router(employee_jobs_router, prefix="/api/v1/employee/jobs", tags=["employee-jobs"])
        app.include_router(job_ai_router, prefix="/api/v1/employee/jobs", tags=["employee-job-ai"])
        app.include_router(eval_dimensions_router, prefix="/api/v1/employee/eval-dimensions", tags=["employee-eval-dimensions"])
        app.include_router(eval_templates_router, prefix="/api/v1/employee/eval-templates", tags=["employee-eval-templates"])
        app.include_router(tags_router, prefix="/api/v1/employee/tags", tags=["employee-tags"])
        app.include_router(depts_router, prefix="/api/v1/employee/depts", tags=["employee-depts"])
        app.include_router(employee_applications_router, prefix="/api/v1/employee/applications", tags=["employee-applications"])
        app.include_router(evaluations_router, prefix="/api/v1/employee/evaluations", tags=["employee-evaluations"])
        app.include_router(employee_resumes_router, prefix="/api/v1/employee/resumes", tags=["employee-resumes"])
        app.include_router(analytics_router, prefix="/api/v1/employee/analytics", tags=["employee-analytics"])
        app.include_router(account_management_router, prefix="/api/v1/employee/account-management", tags=["employee-account-management"])
        app.include_router(create_system_router(self.settings))

    def _mount_static_files(self, app: FastAPI) -> None:
        storage_path = os.path.abspath(self.settings.LOCAL_STORAGE_PATH)
        if os.path.exists(storage_path):
            app.mount("/files", StaticFiles(directory=storage_path), name="files")


def create_app(settings: Settings) -> FastAPI:
    return ApplicationContainer(settings).create_app()
