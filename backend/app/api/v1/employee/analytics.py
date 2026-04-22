from fastapi import APIRouter, Depends, Query
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse
from app.repositories.job_repo import JobRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.eval_repo import EvalRepository

router = APIRouter()


def get_repos(db=Depends(get_db)):
    return {
        "job": JobRepository(db),
        "resume": ResumeRepository(db),
        "eval": EvalRepository(db)
    }


@router.get("/dashboard", response_model=ApiResponse)
async def get_dashboard_stats(
    repos=Depends(get_repos),
    current_user: dict = Depends(get_current_user)
):
    """获取工作台统计数据"""
    # 在招岗位数
    job_count = await repos["job"].count_active()

    # 简历总数
    resume_count = await repos["resume"].count_all()

    # 待评估数（评估完成的简历但无匹配记录的）
    pending_count = await repos["eval"].count_pending_evaluations()

    # 平均匹配率
    avg_score = await repos["eval"].get_avg_match_score()

    # 最近动态（模拟数据，实际应从活动日志表查询）
    recent_activities = [
        {"id": 1, "type": "application", "text": "张三投递了 前端工程师 岗位", "time": "10分钟前"},
        {"id": 2, "type": "evaluation", "text": "李四完成了 AI评估", "time": "30分钟前"},
        {"id": 3, "type": "resume_upload", "text": "王五上传了新简历", "time": "1小时前"},
        {"id": 4, "type": "evaluation", "text": "系统完成了 5 份简历评估", "time": "2小时前"},
    ]

    return ApiResponse(data={
        "job_count": job_count,
        "resume_count": resume_count,
        "pending_eval_count": pending_count,
        "avg_match_score": round(avg_score, 1) if avg_score else 0,
        "recent_activities": recent_activities
    })


@router.get("/job/{job_id}/match-distribution", response_model=ApiResponse)
async def get_match_distribution(
    job_id: int,
    repos=Depends(get_repos),
    current_user: dict = Depends(get_current_user)
):
    """获取岗位匹配度分布（饼图数据）"""
    distribution = await repos["eval"].get_match_distribution(job_id)
    return ApiResponse(data=distribution)


@router.get("/job/{job_id}/resume-list", response_model=ApiResponse)
async def get_job_resume_list(
    job_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    repos=Depends(get_repos),
    current_user: dict = Depends(get_current_user)
):
    """获取岗位下的简历列表（按匹配度降序）"""
    resumes, total = await repos["eval"].get_resumes_by_job(job_id, (page-1)*page_size, page_size)
    items = [
        {
            "resume_id": r["resume_id"],
            "file_name": r["file_name"],
            "match_id": r.get("match_id"),
            "final_score": r.get("final_score"),
            "final_label": r.get("final_label", "待评估"),
            "status": r.get("status", "pending")
        }
        for r in resumes
    ]
    return ApiResponse(data={"total": total, "items": items})
