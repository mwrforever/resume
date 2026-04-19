from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
from app.api.v1.employee.jobs import router as employee_jobs_router
from app.api.v1.employee.jobs.skill import router as skill_router
from app.api.v1.employee.applications import router as employee_applications_router

# Register routers
app.include_router(user_auth_router, prefix="/api/v1/user/auth", tags=["user-auth"])
app.include_router(employee_auth_router, prefix="/api/v1/employee/auth", tags=["employee-auth"])
app.include_router(user_resumes_router, prefix="/api/v1/user/resumes", tags=["user-resumes"])
app.include_router(user_jobs_router, prefix="/api/v1/user/jobs", tags=["user-jobs"])
app.include_router(user_applications_router, prefix="/api/v1/user/applications", tags=["user-applications"])
app.include_router(employee_jobs_router, prefix="/api/v1/employee/jobs", tags=["employee-jobs"])
app.include_router(skill_router, prefix="/api/v1/employee/jobs/skill", tags=["employee-skill"])
app.include_router(employee_applications_router, prefix="/api/v1/employee/applications", tags=["employee-applications"])


@app.exception_handler(BizError)
async def biz_error_handler(request, exc: BizError):
    return JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": None}
    )


@app.get("/")
async def root():
    return {"message": "Resume Platform API"}
