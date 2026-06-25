from __future__ import annotations

import logging
import json
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import BASE_DIR, get_settings
from app.core.exceptions import NotFoundError, ValidationError
from app.utils.cache_utils import (
    EVAL_RECENT_KEY,
    EVAL_PENDING_COUNT_KEY,
    EVAL_AVG_SCORE_KEY,
)
from app.llm.graphs.evaluation_graph import (
    EvaluationDimensionSpec,
    EvaluationSkillSpec,
    EvaluationState,
    run_sync as run_evaluation_graph_sync,
)
from app.utils.resume_parser import extract_resume_text
from app.workers.celery_app import celery_app
from app.workers.db import mysql_manager_sync, redis_manager_sync

logger = logging.getLogger(__name__)


def _get_label(score: float) -> str:
    if score >= 90:
        return "优秀"
    if score >= 70:
        return "良好"
    if score >= 50:
        return "一般"
    return "未达标"


def _get_resume(session: Session, resume_id: int) -> dict[str, Any] | None:
    row = session.execute(
        text("SELECT id, file_path, raw_text FROM resume WHERE id = :resume_id AND is_deleted = 0"),
        {"resume_id": resume_id},
    ).mappings().first()
    return dict(row) if row else None


def _get_application(session: Session, application_id: int) -> dict[str, Any] | None:
    row = session.execute(
        text(
            "SELECT id, resume_id, job_id, job_snapshot FROM job_application "
            "WHERE id = :application_id AND is_deleted = 0"
        ),
        {"application_id": application_id},
    ).mappings().first()
    if not row:
        return None
    data = dict(row)
    snapshot = data.get("job_snapshot")
    if isinstance(snapshot, str):
        data["job_snapshot"] = json.loads(snapshot)
    return data


def _get_match_id(session: Session, application_id: int) -> int | None:
    row = session.execute(
        text(
            "SELECT id FROM resume_job_match "
            "WHERE application_id = :application_id"
        ),
        {"application_id": application_id},
    ).mappings().first()
    return int(row["id"]) if row else None


def _get_or_create_match_id(session: Session, application_id: int, resume_id: int, job_id: int) -> int:
    match_id = _get_match_id(session, application_id)
    if match_id:
        return match_id
    session.execute(
        text(
            # 显式占位 final_score / final_label：旧库列无 DB 级 DEFAULT，
            # 不写就触发 MySQL 1364；评估完成后由后续 UPDATE 覆盖为真实值。
            "INSERT INTO resume_job_match (application_id, resume_id, job_id, final_score, final_label) "
            "VALUES (:application_id, :resume_id, :job_id, 0, '未达标')"
        ),
        {"application_id": application_id, "resume_id": resume_id, "job_id": job_id},
    )
    session.flush()
    created_match_id = _get_match_id(session, application_id)
    if not created_match_id:
        raise ValidationError("创建评估匹配记录失败")
    return created_match_id


def _delete_old_results(session: Session, match_id: int) -> None:
    session.execute(text("DELETE FROM resume_eval_detail WHERE match_id = :match_id"), {"match_id": match_id})
    session.execute(text("DELETE FROM resume_skill_hit WHERE match_id = :match_id"), {"match_id": match_id})


def _get_template_dimensions(session: Session, template_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            "SELECT etd.dimension_id, ed.dimension_name, etd.weight, etd.prompt_template "
            "FROM eval_template_dimension etd "
            "JOIN eval_dimension ed ON ed.id = etd.dimension_id AND ed.is_deleted = 0 AND ed.status = 1 "
            "WHERE etd.template_id = :template_id "
            "ORDER BY etd.sort_order , etd.id "
        ),
        {"template_id": template_id},
    ).mappings().all()
    return [
        {
            "dimension_id": int(row["dimension_id"]),
            "dimension_name": row["dimension_name"],
            "weight": float(row["weight"]),
            "prompt_template": row["prompt_template"],
        }
        for row in rows
    ]


def _get_template_skills(session: Session, template_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            "SELECT id, skill_name, skill_type "
            "FROM eval_template_skill "
            "WHERE template_id = :template_id "
            "ORDER BY skill_type , id "
        ),
        {"template_id": template_id},
    ).mappings().all()
    return [
        {
            "skill_id": int(row["id"]),
            "skill": row["skill_name"],
            "type": int(row["skill_type"]),
        }
        for row in rows
    ]


def _parse_resume_text(resume: dict[str, Any]) -> str:
    settings = get_settings()
    file_path = Path(str(resume["file_path"]))
    if not file_path.is_absolute():
        storage_path = Path(settings.LOCAL_STORAGE_PATH)
        if not storage_path.is_absolute():
            storage_path = BASE_DIR / storage_path
        file_path = storage_path / file_path
    if not file_path.exists():
        raise NotFoundError("简历文件不存在")
    raw_text = extract_resume_text(file_path)
    return raw_text


def _save_evaluation_results(
    session: Session,
    application_id: int,
    resume_id: int,
    job_id: int,
    raw_text: str,
    dimension_results: list[dict[str, Any]],
    skill_hits: list[dict[str, Any]],
    final_score: float,
    final_label: str,
    advantage_comment: str,
    disadvantage_comment: str,
) -> int:
    match_id = _get_or_create_match_id(session, application_id, resume_id, job_id)
    _delete_old_results(session, match_id)

    if raw_text:
        session.execute(
            text("UPDATE resume SET raw_text = :raw_text WHERE id = :resume_id"),
            {"resume_id": resume_id, "raw_text": raw_text},
        )

    for item in dimension_results:
        session.execute(
            text(
                "INSERT INTO resume_eval_detail "
                "(match_id, dimension_id, dimension_score, dimension_advantage, "
                "dimension_disadvantage, is_completed, error_message) "
                "VALUES (:match_id, :dimension_id, :score, :advantage, "
                ":disadvantage, :is_completed, :error_message)"
            ),
            {
                "match_id": match_id,
                "dimension_id": item["dimension_id"],
                "score": item["score"],
                "advantage": item["advantage"],
                "disadvantage": item["disadvantage"],
                "is_completed": 1 if item["is_completed"] else 0,
                "error_message": item.get("error_message"),
            },
        )

    for hit in skill_hits:
        session.execute(
            text(
                "INSERT INTO resume_skill_hit "
                "(match_id, skill_id, is_hit, hit_context) "
                "VALUES (:match_id, :skill_id, :is_hit, :hit_context)"
            ),
            {
                "match_id": match_id,
                "skill_id": hit["skill_id"],
                "is_hit": hit["is_hit"],
                "hit_context": hit["hit_context"],
            },
        )

    _update_match_result(
        session,
        match_id,
        final_score,
        final_label,
        advantage_comment,
        disadvantage_comment,
    )
    session.commit()
    return match_id


def _update_match_result(
    session: Session,
    match_id: int,
    score: float,
    label: str,
    advantage: str,
    disadvantage: str,
) -> None:
    session.execute(
        text(
            "UPDATE resume_job_match SET final_score = :score, final_label = :label, "
            "advantage_comment = :advantage, disadvantage_comment = :disadvantage, "
            "error_message = NULL, evaluated_at = NOW() WHERE id = :match_id"
        ),
        {
            "match_id": match_id,
            "score": score,
            "label": label,
            "advantage": advantage,
            "disadvantage": disadvantage,
        },
    )


def _load_evaluation_context(session: Session, application_id: int) -> dict[str, Any]:
    application = _get_application(session, application_id)
    if not application:
        raise NotFoundError("投递记录不存在")
    if not application.get("job_snapshot"):
        raise ValidationError("投递快照不存在，无法评估")

    resume_id = int(application["resume_id"])
    job_id = int(application["job_id"])
    snapshot = application["job_snapshot"]
    resume = _get_resume(session, resume_id)
    if not resume:
        raise NotFoundError("简历不存在或未解析")

    job = snapshot.get("job", {})
    template_id = job.get("template_id")
    if not template_id:
        raise ValidationError("投递快照未包含模板ID，无法评估")

    dimensions = _get_template_dimensions(session, template_id)
    if not dimensions:
        raise NotFoundError("评估模板维度不存在，无法评估")

    skills = _get_template_skills(session, template_id)
    return {
        "application_id": application_id,
        "resume_id": resume_id,
        "job_id": job_id,
        "resume": resume,
        "job": job,
        "dimensions": dimensions,
        "skills": skills,
    }


def _evaluate_application(context: dict[str, Any]) -> dict[str, Any]:
    """
    调用评估 LangGraph 子图完成一次投递评估。

    与 Agent 链路同源复用 ``app.llm.graphs.evaluation_graph``，本函数只负责：
    1. 准备简历原文（不存在则即时解析）
    2. 构造 ``EvaluationState`` 触发子图
    3. 把子图结果落回 Celery 原有的写入结构
    """
    application_id = int(context["application_id"])
    resume_id = int(context["resume_id"])
    job_id = int(context["job_id"])
    resume = context["resume"]
    job = context["job"]
    dimensions = context["dimensions"]
    skills = context["skills"]

    existing_resume_text = str(resume.get("raw_text") or "")
    parsed_resume_text = ""
    resume_text = existing_resume_text
    if not resume_text:
        parsed_resume_text = _parse_resume_text(resume)
        resume_text = parsed_resume_text
    if not resume_text:
        raise NotFoundError("简历不存在或未解析")

    state = EvaluationState(
        application_id=application_id,
        resume_id=resume_id,
        job_id=job_id,
        job_name=str(job.get("name") or ""),
        job_description=str(job.get("description") or ""),
        resume_text=resume_text,
        dimensions=[
            EvaluationDimensionSpec(
                dimension_id=int(dim["dimension_id"]),
                dimension_name=str(dim["dimension_name"]),
                weight=float(dim["weight"]),
                prompt_template=str(dim.get("prompt_template") or ""),
            )
            for dim in dimensions
        ],
        skills=[
            EvaluationSkillSpec(
                skill_id=int(skill["skill_id"]),
                skill=str(skill["skill"]),
                type=int(skill["type"]),
            )
            for skill in skills
        ],
    )

    eval_result = run_evaluation_graph_sync(state)
    completed = [item for item in eval_result.dimensions if item.is_completed]
    if not completed:
        raise ValidationError("AI评估结果缺少有效维度")

    final_label = eval_result.final_label or _get_label(eval_result.final_score)
    return {
        "application_id": application_id,
        "resume_id": resume_id,
        "job_id": job_id,
        "parsed_resume_text": parsed_resume_text,
        "final_score": eval_result.final_score,
        "final_label": final_label,
        "dimensions": [
            {
                "dimension_id": item.dimension_id,
                "dimension_name": item.dimension_name,
                "score": item.score,
                "advantage": item.advantage,
                "disadvantage": item.disadvantage,
                "is_completed": item.is_completed,
                "error_message": item.error_message,
            }
            for item in eval_result.dimensions
        ],
        "skill_hits": [
            {
                "skill_id": item.skill_id,
                "is_hit": 1 if item.is_hit else 0,
                "hit_context": item.hit_context,
            }
            for item in eval_result.skill_hits
        ],
        "advantage_comment": eval_result.advantage_comment,
        "disadvantage_comment": eval_result.disadvantage_comment,
    }


def _sync_eval_logic(application_ids: list[int]) -> dict[str, Any]:
    logger.info(f"开始评估 {len(application_ids)} 条投递")

    results: list[dict[str, Any]] = []

    try:
        for application_id in application_ids:
            try:
                with mysql_manager_sync.session() as session:
                    context = _load_evaluation_context(session, application_id)
                    session.rollback()

                result = _evaluate_application(context)

                with mysql_manager_sync.session() as session:
                    match_id = _save_evaluation_results(
                        session,
                        int(result["application_id"]),
                        int(result["resume_id"]),
                        int(result["job_id"]),
                        str(result.get("parsed_resume_text") or ""),
                        result["dimensions"],
                        result["skill_hits"],
                        float(result["final_score"]),
                        str(result["final_label"]),
                        str(result.get("advantage_comment") or ""),
                        str(result.get("disadvantage_comment") or ""),
                    )
                logger.info(f"投递 {application_id} 评估完成，得分 {result['final_score']}")
                results.append({
                    "application_id": application_id,
                    "status": "success",
                    "match_id": match_id,
                })
            except Exception as exc:
                logger.error(f"投递 {application_id} 评估失败: {exc}")
                results.append({
                    "application_id": application_id,
                    "status": "failed",
                    "error": str(exc),
                })
        _invalidate_eval_cache()
    finally:
        pass

    return {"status": "completed", "count": len(application_ids), "results": results}


def _invalidate_eval_cache() -> None:
    """评估完成后清除缓存（使用同步Redis客户端）"""
    try:
        client = redis_manager_sync.client
        client.delete(EVAL_RECENT_KEY)
        client.delete(EVAL_PENDING_COUNT_KEY)
        client.delete(EVAL_AVG_SCORE_KEY)
    except Exception as exc:
        logger.warning(f"评估完成但缓存清除失败: {exc}")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, ignore_result=True)
def run_evaluation_task(self, application_ids: list[int]) -> dict[str, Any]:
    try:
        return _sync_eval_logic(application_ids)
    except Exception as exc:
        logger.error(f"批量评估任务失败，准备重试: {exc}")
        raise self.retry(exc=exc)
