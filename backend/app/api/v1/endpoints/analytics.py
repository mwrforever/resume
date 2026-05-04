from fastapi import APIRouter, Depends, Query

from app.deps import get_db
from app.deps import get_cache
from app.services.cache_service import CacheService
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.repositories.application_repository import ApplicationRepository
from app.services.evaluation_service import EvalService
from app.schemas.vo.response.analytics_response import ApiResponse

router = APIRouter()


def get_repos(db=Depends(get_db)):
    return {
        "job": JobRepository(db),
        "resume": ResumeRepository(db),
        "eval": EvalRepository(db)
    }


def get_eval_service(db=Depends(get_db), cache: CacheService = Depends(get_cache)) -> EvalService:
    return EvalService(
        EvalRepository(db),
        ResumeRepository(db),
        JobRepository(db),
        ApplicationRepository(db),
        cache,
    )


@router.get("/dashboard", response_model=ApiResponse)
async def get_dashboard_stats(
    repos=Depends(get_repos),
    eval_service: EvalService = Depends(get_eval_service),
):
    """获取工作台统计数据"""
    job_count = await repos["job"].count_active()
    resume_count = await repos["resume"].count_all()
    pending_count = await eval_service.get_pending_count()
    avg_score = await eval_service.get_avg_score()
    recent_activities = await eval_service.get_recent_activities(10)

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
    eval_service: EvalService = Depends(get_eval_service),
):
    """获取岗位匹配度分布（饼图数据）"""
    distribution = await eval_service.get_match_distribution(job_id)
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