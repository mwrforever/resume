from app.api.v1.employee.resumes import router as employee_router
from app.api.v1.user.resumes import router as user_router

__all__ = ["employee_router", "user_router"]
