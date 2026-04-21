from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles
import os
from app.core.config import get_settings
from app.core.exceptions import BizError
from starlette.responses import JSONResponse

settings = get_settings()

app = FastAPI(title=settings.APP_NAME)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import routers
from app.api.v1.user.auth import router as user_auth_router
from app.api.v1.employee.auth import router as employee_auth_router
from app.api.v1.user.resumes import router as user_resumes_router
from app.api.v1.user.jobs import router as user_jobs_router
from app.api.v1.user.applications import router as user_applications_router
from app.api.v1.employee.job_endpoints import router as employee_jobs_router
from app.api.v1.employee.jobs.skill import router as skill_router
from app.api.v1.employee.applications import router as employee_applications_router
from app.api.v1.employee.evaluations import router as evaluations_router

# Register routers
app.include_router(user_auth_router, prefix="/api/v1/user/auth", tags=["user-auth"])
app.include_router(employee_auth_router, prefix="/api/v1/employee/auth", tags=["employee-auth"])
app.include_router(user_resumes_router, prefix="/api/v1/user/resumes", tags=["user-resumes"])
app.include_router(user_jobs_router, prefix="/api/v1/user/jobs", tags=["user-jobs"])
app.include_router(user_applications_router, prefix="/api/v1/user/applications", tags=["user-applications"])
app.include_router(employee_jobs_router, prefix="/api/v1/employee/jobs", tags=["employee-jobs"])
app.include_router(skill_router, prefix="/api/v1/employee/jobs/skill", tags=["employee-skill"])
app.include_router(employee_applications_router, prefix="/api/v1/employee/applications", tags=["employee-applications"])
app.include_router(evaluations_router, prefix="/api/v1/employee/evaluations", tags=["employee-evaluations"])


@app.exception_handler(BizError)
async def biz_error_handler(request, exc: BizError):
    return JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": None}
    )


# Mount static files for resume preview
storage_path = os.path.abspath(settings.LOCAL_STORAGE_PATH)
if os.path.exists(storage_path):
    app.mount("/files", StaticFiles(directory=storage_path), name="files")


@app.get("/")
async def root():
    return {"message": "Resume Platform API"}


@app.get("/preview/{file_path:path}")
async def preview_resume(file_path: str):
    """简历预览接口（支持PDF和Word）"""
    full_path = os.path.join(storage_path, file_path)
    if not os.path.exists(full_path):
        return JSONResponse(
            status_code=404,
            content={"code": 404, "message": "文件不存在", "data": None}
        )
    return FileResponse(full_path)
