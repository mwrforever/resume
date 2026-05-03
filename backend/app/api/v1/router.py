from fastapi import APIRouter

from app.api.v1.endpoints import (
    user,
    employee,
    resume,
    job,
    application,
    evaluation,
    eval_template,
    dept,
    tag,
    analytics,
    system,
)

api_router = APIRouter()

# 用户认证
api_router.include_router(user.router, prefix="/auth", tags=["认证"])

# 用户管理
api_router.include_router(user.user_manage_router, prefix="/users", tags=["用户管理"])

# 员工认证
api_router.include_router(employee.router, prefix="/employee-auth", tags=["员工认证"])

# 员工管理
api_router.include_router(employee.employee_manage_router, prefix="/employees", tags=["员工管理"])

# 简历
api_router.include_router(resume.user_router, prefix="/user/resumes", tags=["简历-用户"])
api_router.include_router(resume.employee_router, prefix="/resumes", tags=["简历-员工"])

# 岗位
api_router.include_router(job.user_router, prefix="/jobs", tags=["岗位-用户"])
api_router.include_router(job.employee_router, prefix="/jobs", tags=["岗位-员工"])
api_router.include_router(job.employee_ai_router, prefix="/jobs", tags=["岗位-AI"])

# 投递
api_router.include_router(application.user_router, prefix="/applications", tags=["投递-用户"])
api_router.include_router(application.employee_router, prefix="/applications", tags=["投递-员工"])

# 评估
api_router.include_router(evaluation.router, prefix="/evaluations", tags=["评估"])

# 评估模板
api_router.include_router(eval_template.dimension_router, prefix="/dimensions", tags=["评估维度"])
api_router.include_router(eval_template.template_router, prefix="/templates", tags=["评估模板"])

# 部门
api_router.include_router(dept.router, prefix="/depts", tags=["部门"])

# 标签
api_router.include_router(tag.router, prefix="/tags", tags=["标签"])

# 统计分析
api_router.include_router(analytics.router, tags=["统计分析"])

# 系统
api_router.include_router(system.router, tags=["系统"])
