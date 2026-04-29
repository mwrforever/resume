from fastapi import APIRouter, Depends, Query

from app.infrastructure.client import get_db
from app.modules.evaluation.repository import EvalRepository
from app.modules.job.repository import JobRepository
from app.modules.resume.repository import ResumeRepository
from app.schemas.vo.response.analytics_response import ApiResponse

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
):
    """获取工作台统计数据"""
    job_count = await repos["job"].count_active()
    resume_count = await repos["resume"].count_all()
    pending_count = await repos["eval"].count_pending_evaluations()
    avg_score = await repos["eval"].get_avg_match_score()
    recent_activities = await repos["eval"].get_recent_activities(10)

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
):
    """获取岗位下的简历列表（按匹配度降序）"""
    resumes, total = await repos["eval"].get_applications_by_job(job_id, (page-1)*page_size, page_size)
    items = [
        {
            "application_id": r["application_id"],
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


__all__ = ["router"]
