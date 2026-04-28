from __future__ import annotations

import logging
import json
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import BASE_DIR, get_settings
from app.core.exceptions import NotFoundError, ValidationError
from app.utils.ai.chains import ResumeEvalChain
from app.utils.resume_parser import extract_resume_text
from app.infrastructure.celery.app import celery_app

logger = logging.getLogger(__name__)


def _create_sync_engine() -> Engine:
    settings = get_settings()
    database_url = settings.database_url.replace("mysql+aiomysql://", "mysql+pymysql://", 1)
    return create_engine(database_url, echo=False, pool_pre_ping=True)


def _get_label(score: float) -> str:
    if score >= 90:
        return "优秀"
    if score >= 70:
        return "良好"
    if score >= 50:
        return "一般"
    return "未达标"


def _normalize_score(value: Any) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, score))


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
            "INSERT INTO resume_job_match (application_id, resume_id, job_id) "
            "VALUES (:application_id, :resume_id, :job_id)"
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


def _get_dimensions(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "dimension_id": int(row["dimension_id"]),
            "dimension_name": row["dimension_name"],
            "weight": float(row["weight"]),
            "prompt_template": row["prompt_template"],
        }
        for row in snapshot.get("dimensions", [])
    ]


def _get_skills(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "skill_id": int(row["id"]),
            "skill": row["skill_name"],
            "type": int(row["skill_type"]),
        }
        for row in snapshot.get("skills", [])
        if row.get("id") is not None
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


def _build_dimension_results(
    dimensions: list[dict[str, Any]],
    ai_dimensions: list[Any],
) -> list[dict[str, Any]]:
    result_by_name = {
        str(item.get("dimension_name", "")).strip(): item
        for item in ai_dimensions
        if isinstance(item, dict)
    }
    dimension_results = []

    for index, dim in enumerate(dimensions):
        item = result_by_name.get(str(dim["dimension_name"]).strip())
        if item is None and index < len(ai_dimensions) and isinstance(ai_dimensions[index], dict):
            item = ai_dimensions[index]

        if item is None:
            error_message = "AI评估结果缺少该维度"
            dimension_results.append({
                "dimension_id": dim["dimension_id"],
                "dimension_name": dim["dimension_name"],
                "score": 0.0,
                "advantage": "",
                "disadvantage": "",
                "is_completed": False,
                "error_message": error_message,
            })
            continue

        score = _normalize_score(item.get("score"))
        advantage = str(item.get("advantage") or "")
        disadvantage = str(item.get("disadvantage") or "")
        dimension_results.append({
            "dimension_id": dim["dimension_id"],
            "dimension_name": dim["dimension_name"],
            "score": score,
            "advantage": advantage,
            "disadvantage": disadvantage,
            "is_completed": True,
        })

    return dimension_results


def _build_skill_hits(skills: list[dict[str, Any]], ai_hits: list[Any]) -> list[dict[str, Any]]:
    hit_by_name = {
        str(item.get("skill", "")).strip(): item
        for item in ai_hits
        if isinstance(item, dict)
    }
    skill_hits = []

    for skill in skills:
        item = hit_by_name.get(str(skill["skill"]).strip())
        is_hit = bool(item and item.get("is_hit"))
        hit_context = str(item.get("hit_context") or "") if item else ""
        skill_hits.append({
            "skill_id": skill["skill_id"],
            "is_hit": 1 if is_hit else 0,
            "hit_context": hit_context,
        })
    return skill_hits


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
    dimensions = _get_dimensions(snapshot)
    if not dimensions:
        raise NotFoundError("投递快照未包含评估维度，无法评估")

    skills = _get_skills(snapshot)
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

    eval_result = ResumeEvalChain().evaluate(
        resume_text,
        str(job["name"]),
        str(job.get("description") or ""),
        [
            {
                "dimension_name": dim["dimension_name"],
                "weight": dim["weight"],
                "prompt_template": dim["prompt_template"],
            }
            for dim in dimensions
        ],
        [{"skill": skill["skill"], "type": skill["type"]} for skill in skills],
    )

    dimension_results = _build_dimension_results(
        dimensions,
        eval_result.get("dimensions", []),
    )

    completed_results = [item for item in dimension_results if item["is_completed"]]
    if not completed_results:
        raise ValidationError("AI评估结果缺少有效维度")

    final_score = _normalize_score(eval_result.get("final_score"))
    final_label = str(eval_result.get("final_label") or "") or _get_label(final_score)
    advantage_comment = str(eval_result.get("advantage_comment") or "")
    disadvantage_comment = str(eval_result.get("disadvantage_comment") or "")

    skill_hits = _build_skill_hits(skills, eval_result.get("skill_hits", []))
    return {
        "application_id": application_id,
        "resume_id": resume_id,
        "job_id": job_id,
        "parsed_resume_text": parsed_resume_text,
        "final_score": final_score,
        "final_label": final_label,
        "dimensions": dimension_results,
        "skill_hits": skill_hits,
        "advantage_comment": advantage_comment,
        "disadvantage_comment": disadvantage_comment,
    }


def _sync_eval_logic(application_ids: list[int]) -> dict[str, Any]:
    logger.info(f"开始评估 {len(application_ids)} 条投递")

    engine = _create_sync_engine()
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    results: list[dict[str, Any]] = []

    try:
        for application_id in application_ids:
            try:
                with session_factory() as session:
                    context = _load_evaluation_context(session, application_id)
                    session.rollback()

                result = _evaluate_application(context)

                with session_factory() as session:
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
    finally:
        engine.dispose()

    return {"status": "completed", "count": len(application_ids), "results": results}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, ignore_result=True)
def run_evaluation_task(self, application_ids: list[int]) -> dict[str, Any]:
    try:
        return _sync_eval_logic(application_ids)
    except Exception as exc:
        logger.error(f"批量评估任务失败，准备重试: {exc}")
        raise self.retry(exc=exc)
