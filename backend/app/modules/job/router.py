from app.api.v1.employee.job_endpoints import router as employee_router
from app.api.v1.employee.jobs.ai import router as employee_ai_router
from app.api.v1.user.jobs import router as user_router

__all__ = ["employee_ai_router", "employee_router", "user_router"]
