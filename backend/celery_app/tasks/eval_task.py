from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import BASE_DIR, get_settings
from app.core.exceptions import NotFoundError, ValidationError
from app.utils.ai.chains import ResumeEvalChain
from app.utils.resume_parser import extract_resume_text
from celery_app.celery import celery_app

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


def _get_job(session: Session, job_id: int) -> dict[str, Any] | None:
    row = session.execute(
        text("SELECT id, name, description FROM job_position WHERE id = :job_id AND is_deleted = 0"),
        {"job_id": job_id},
    ).mappings().first()
    return dict(row) if row else None


def _get_match_id(session: Session, resume_id: int, job_id: int) -> int | None:
    row = session.execute(
        text(
            "SELECT id FROM resume_job_match "
            "WHERE resume_id = :resume_id AND job_id = :job_id"
        ),
        {"resume_id": resume_id, "job_id": job_id},
    ).mappings().first()
    return int(row["id"]) if row else None


def _get_or_create_match_id(session: Session, resume_id: int, job_id: int) -> int:
    match_id = _get_match_id(session, resume_id, job_id)
    if match_id:
        return match_id
    session.execute(
        text("INSERT INTO resume_job_match (resume_id, job_id) VALUES (:resume_id, :job_id)"),
        {"resume_id": resume_id, "job_id": job_id},
    )
    session.flush()
    created_match_id = _get_match_id(session, resume_id, job_id)
    if not created_match_id:
        raise ValidationError("创建评估匹配记录失败")
    return created_match_id


def _delete_old_results(session: Session, match_id: int) -> None:
    session.execute(text("DELETE FROM resume_eval_detail WHERE match_id = :match_id"), {"match_id": match_id})
    session.execute(text("DELETE FROM resume_skill_hit WHERE match_id = :match_id"), {"match_id": match_id})


def _get_dimensions(session: Session, job_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            "SELECT id, dimension_name, weight, prompt_template "
            "FROM job_eval_dimension WHERE job_id = :job_id ORDER BY sort_order ASC"
        ),
        {"job_id": job_id},
    ).mappings().all()
    return [
        {
            "dimension_id": int(row["id"]),
            "dimension_name": row["dimension_name"],
            "weight": float(row["weight"]),
            "prompt_template": row["prompt_template"],
        }
        for row in rows
    ]


def _get_skills(session: Session, job_id: int) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            "SELECT id, skill_name, skill_type "
            "FROM job_skill WHERE job_id = :job_id ORDER BY skill_type ASC"
        ),
        {"job_id": job_id},
    ).mappings().all()
    return [
        {
            "skill_id": int(row["id"]),
            "skill": row["skill_name"],
            "type": int(row["skill_type"]),
        }
        for row in rows
    ]


def _parse_resume_text(session: Session, resume: dict[str, Any]) -> str:
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
    if raw_text:
        session.execute(
            text("UPDATE resume SET raw_text = :raw_text WHERE id = :resume_id"),
            {"resume_id": resume["id"], "raw_text": raw_text},
        )
    return raw_text


def _save_dimension_results(
    session: Session,
    match_id: int,
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
                    "dimension_id": dim["dimension_id"],
                    "score": 0.0,
                    "advantage": "",
                    "disadvantage": "",
                    "is_completed": 0,
                    "error_message": error_message,
                },
            )
            dimension_results.append({
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
                "dimension_id": dim["dimension_id"],
                "score": score,
                "advantage": advantage,
                "disadvantage": disadvantage,
                "is_completed": 1,
                "error_message": None,
            },
        )
        dimension_results.append({
            "dimension_name": dim["dimension_name"],
            "score": score,
            "advantage": advantage,
            "disadvantage": disadvantage,
            "is_completed": True,
        })

    return dimension_results


def _save_skill_hits(session: Session, match_id: int, skills: list[dict[str, Any]], ai_hits: list[Any]) -> None:
    hit_by_name = {
        str(item.get("skill", "")).strip(): item
        for item in ai_hits
        if isinstance(item, dict)
    }

    for skill in skills:
        item = hit_by_name.get(str(skill["skill"]).strip())
        is_hit = bool(item and item.get("is_hit"))
        hit_context = str(item.get("hit_context") or "") if item else ""
        session.execute(
            text(
                "INSERT INTO resume_skill_hit "
                "(match_id, skill_id, is_hit, hit_context) "
                "VALUES (:match_id, :skill_id, :is_hit, :hit_context)"
            ),
            {
                "match_id": match_id,
                "skill_id": skill["skill_id"],
                "is_hit": 1 if is_hit else 0,
                "hit_context": hit_context,
            },
        )


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


def _update_match_error(session: Session, match_id: int, error_message: str) -> None:
    session.execute(
        text("UPDATE resume_job_match SET error_message = :error_message WHERE id = :match_id"),
        {"match_id": match_id, "error_message": error_message[:500]},
    )


def _evaluate_resume(session: Session, resume_id: int, job_id: int) -> dict[str, Any]:
    resume = _get_resume(session, resume_id)
    if not resume:
        raise NotFoundError("简历不存在或未解析")
    resume_text = str(resume.get("raw_text") or "") or _parse_resume_text(session, resume)
    if not resume_text:
        raise NotFoundError("简历不存在或未解析")

    job = _get_job(session, job_id)
    if not job:
        raise NotFoundError("岗位不存在")

    match_id = _get_or_create_match_id(session, resume_id, job_id)
    _delete_old_results(session, match_id)

    dimensions = _get_dimensions(session, job_id)
    if not dimensions:
        raise NotFoundError("岗位未配置评估维度，无法评估")

    skills = _get_skills(session, job_id)
    session.commit()

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

    dimension_results = _save_dimension_results(
        session,
        match_id,
        dimensions,
        eval_result.get("dimensions", []),
    )
    session.commit()

    completed_results = [item for item in dimension_results if item["is_completed"]]
    if not completed_results:
        raise ValidationError("AI评估结果缺少有效维度")

    total_weighted_score = 0.0
    total_weight = 0.0
    for result, dim in zip(dimension_results, dimensions):
        if result["is_completed"]:
            total_weighted_score += result["score"] * dim["weight"]
            total_weight += dim["weight"]

    if total_weight > 0:
        original_total = sum(dim["weight"] for dim in dimensions)
        total_weighted_score = (total_weighted_score / total_weight) * original_total

    label = _get_label(total_weighted_score)
    advantage_comment = str(eval_result.get("advantage_comment") or "")
    disadvantage_comment = str(eval_result.get("disadvantage_comment") or "")

    _update_match_result(
        session,
        match_id,
        total_weighted_score,
        label,
        advantage_comment,
        disadvantage_comment,
    )
    _save_skill_hits(session, match_id, skills, eval_result.get("skill_hits", []))
    session.commit()

    logger.info(f"简历 {resume_id} 评估完成，岗位 {job_id}，得分 {total_weighted_score}")
    return {
        "match_id": match_id,
        "final_score": total_weighted_score,
        "final_label": label,
        "dimensions": dimension_results,
        "advantage_comment": advantage_comment,
        "disadvantage_comment": disadvantage_comment,
    }


def _sync_eval_logic(resume_ids: list[int], job_id: int) -> dict[str, Any]:
    logger.info(f"开始评估 {len(resume_ids)} 份简历，岗位 {job_id}")

    engine = _create_sync_engine()
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    results: list[dict[str, Any]] = []

    try:
        with session_factory() as session:
            for resume_id in resume_ids:
                try:
                    result = _evaluate_resume(session, resume_id, job_id)
                    results.append({
                        "resume_id": resume_id,
                        "status": "success",
                        "match_id": result.get("match_id"),
                    })
                except Exception as exc:
                    session.rollback()
                    match_id = _get_match_id(session, resume_id, job_id)
                    if match_id:
                        _update_match_error(session, match_id, str(exc))
                        session.commit()
                    logger.error(f"简历 {resume_id} 评估失败: {exc}")
                    results.append({
                        "resume_id": resume_id,
                        "status": "failed",
                        "error": str(exc),
                    })
    finally:
        engine.dispose()

    return {"status": "completed", "count": len(resume_ids), "results": results}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, ignore_result=True)
def run_evaluation_task(self, resume_ids: list[int], job_id: int) -> dict[str, Any]:
    try:
        return _sync_eval_logic(resume_ids, job_id)
    except Exception as exc:
        logger.error(f"批量评估任务失败，准备重试: {exc}")
        raise self.retry(exc=exc)
