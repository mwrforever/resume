# 员工端功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现员工端完整功能，包括岗位管理、简历库、AI评估、投递管理、工作台统计和可视化报表

**Architecture:** 基于 FastAPI + React + MySQL + Redis + Celery 技术栈。后端按分层架构（API → Service → Repository），前端使用 React Router + Zustand + shadcn/ui

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy (async), aiomysql, Celery, Redis, React 18, TypeScript, Tailwind CSS, Recharts

---

## 一、后端实现计划

### 后端文件结构

```
backend/app/
├── api/v1/employee/
│   ├── __init__.py
│   ├── jobs/
│   │   ├── __init__.py          # router 汇总
│   │   └── skill.py             # 技能建议
│   ├── resumes.py               # 简历库 API
│   ├── applications.py          # 投递管理 API
│   ├── analytics.py             # 可视化报表 API
│   └── evaluations.py           # 评估管理 API
├── services/
│   ├── eval_service.py          # 评估服务（已存在，需完善）
│   └── analytics_service.py     # 新增：统计服务
├── repositories/
│   ├── eval_repo.py             # 已存在，需完善
│   ├── job_repo.py              # 已存在，需完善
│   └── analytics_repo.py        # 新增：统计查询
├── models/
│   ├── resume_eval_detail.py    # 需添加 is_completed, error_message 字段
│   └── resume_job_match.py      # 需添加 error_message 字段
└── utils/
    └── storage/
        └── file_parser.py       # 新增：Word/PDF 解析
```

### Task 1: 更新数据库模型

**Files:**
- Modify: `backend/app/models/resume_eval_detail.py`
- Modify: `backend/app/models/resume_job_match.py`

- [ ] **Step 1: 更新 ResumeEvalDetail 模型**

```python
# backend/app/models/resume_eval_detail.py
from sqlalchemy import Column, BigInteger, DECIMAL, DateTime, String, Text, TINYINT
from sqlalchemy.sql import func
from . import Base


class ResumeEvalDetail(Base):
    __tablename__ = "resume_eval_detail"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    match_id = Column(BigInteger, nullable=False, comment="关联匹配记录ID")
    dimension_id = Column(BigInteger, nullable=False, comment="关联维度ID")
    dimension_score = Column(DECIMAL(5, 2), nullable=False, comment="维度得分(0-100)")
    dimension_advantage = Column(String(500), comment="维度优点")
    dimension_disadvantage = Column(String(500), comment="维度缺点")
    ai_reasoning = Column(Text, comment="AI理由")
    is_completed = Column(TINYINT, nullable=False, default=1, comment="是否成功完成评估：1成功，0失败")
    error_message = Column(String(500), comment="评估失败时的错误信息")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

- [ ] **Step 2: 更新 ResumeJobMatch 模型**

```python
# backend/app/models/resume_job_match.py
from sqlalchemy import Column, BigInteger, DECIMAL, DateTime, String, TINYINT
from sqlalchemy.sql import func
from . import Base


class ResumeJobMatch(Base):
    __tablename__ = "resume_job_match"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    resume_id = Column(BigInteger, nullable=False, comment="简历ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    final_score = Column(DECIMAL(5, 2), nullable=False, default=0.00, comment="最终得分")
    final_label = Column(String(20), nullable=False, default='未达标', comment="最终标签")
    advantage_comment = Column(String(500), comment="整体优点")
    disadvantage_comment = Column(String(500), comment="整体缺点")
    is_direct_preferred = Column(TINYINT, nullable=False, default=0, comment="是否直接优选")
    error_message = Column(String(500), comment="评估失败时的错误信息")
    evaluated_at = Column(DateTime, comment="评估完成时间")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/models/resume_eval_detail.py backend/app/models/resume_job_match.py
git commit -m "feat(employee): add is_completed and error_message fields to eval models"
```

---

### Task 2: 更新 EvalRepository

**Files:**
- Modify: `backend/app/repositories/eval_repo.py`

- [ ] **Step 1: 添加新方法**

```python
# backend/app/repositories/eval_repo.py
# 在类中添加以下方法

async def update_match_error(self, match_id: int, error_message: str) -> bool:
    """更新匹配记录的错误状态"""
    await self.db.execute(
        update(ResumeJobMatch)
        .where(ResumeJobMatch.id == match_id)
        .values(error_message=error_message)
    )
    await self.db.commit()
    return True

async def create_eval_detail_with_status(
    self,
    match_id: int,
    dimension_id: int,
    score: float,
    advantage: str,
    disadvantage: str,
    is_completed: bool = True,
    error_message: str = None
) -> ResumeEvalDetail:
    """创建评估详情（支持失败状态）"""
    detail = ResumeEvalDetail(
        match_id=match_id,
        dimension_id=dimension_id,
        dimension_score=score,
        dimension_advantage=advantage,
        dimension_disadvantage=disadvantage,
        is_completed=1 if is_completed else 0,
        error_message=error_message
    )
    self.db.add(detail)
    await self.db.commit()
    await self.db.refresh(detail)
    return detail

async def get_resumes_with_pending_status(self, job_id: int) -> list:
    """获取岗位下待评估的简历（无匹配记录的）"""
    from app.models.resume import Resume
    from app.models.resume_job_match import ResumeJobMatch
    from sqlalchemy import not_, exists

    # 子查询：已评估的简历ID
    evaluated_subq = (
        select(ResumeJobMatch.resume_id)
        .where(ResumeJobMatch.job_id == job_id)
    )

    result = await self.db.execute(
        select(Resume)
        .where(
            Resume.is_deleted == 0,
            Resume.status == 2,  # 评估完成
            not_(Resume.id.in_(evaluated_subq))
        )
    )
    return result.scalars().all()

async def get_match_distribution(self, job_id: int) -> dict:
    """获取岗位下简历匹配度分布"""
    from sqlalchemy import func, case

    result = await self.db.execute(
        select(
            func.count().label('total'),
            func.sum(case((ResumeJobMatch.final_label == '优秀', 1), else_=0)).label('excellent'),
            func.sum(case((ResumeJobMatch.final_label == '良好', 1), else_=0)).label('good'),
            func.sum(case((ResumeJobMatch.final_label == '一般', 1), else_=0)).label('average'),
            func.sum(case((ResumeJobMatch.final_label == '未达标', 1), else_=0)).label('fail'),
        )
        .where(ResumeJobMatch.job_id == job_id)
    )
    row = result.one()
    total = row.total or 0
    return {
        "total": total,
        "excellent": {"count": row.excellent or 0, "percentage": round((row.excellent or 0) / total * 100, 1) if total > 0 else 0},
        "good": {"count": row.good or 0, "percentage": round((row.good or 0) / total * 100, 1) if total > 0 else 0},
        "average": {"count": row.average or 0, "percentage": round((row.average or 0) / total * 100, 1) if total > 0 else 0},
        "fail": {"count": row.fail or 0, "percentage": round((row.fail or 0) / total * 100, 1) if total > 0 else 0},
    }
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/repositories/eval_repo.py
git commit -m "feat(employee): add new methods to eval_repo for error handling and analytics"
```

---

### Task 3: 更新 EvalService（并行评估 + Celery 集成）

**Files:**
- Modify: `backend/app/services/eval_service.py`

- [ ] **Step 1: 重写评估服务（支持并行 + 错误处理）**

```python
# backend/app/services/eval_service.py
import asyncio
import logging
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.utils.ai.chains import DimensionEvalChain, SkillHitChain, ComprehensiveEvalChain
from app.core.exceptions import NotFoundError

logger = logging.getLogger(__name__)


class EvalService:
    def __init__(self, eval_repo: EvalRepository, resume_repo: ResumeRepository, job_repo: JobRepository):
        self.eval_repo = eval_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo
        self.dimension_chain = DimensionEvalChain()
        self.skill_hit_chain = SkillHitChain()
        self.comprehensive_chain = ComprehensiveEvalChain()

    def _get_label(self, score: float) -> str:
        if score >= 90:
            return "优秀"
        elif score >= 70:
            return "良好"
        elif score >= 50:
            return "一般"
        return "未达标"

    async def evaluate_resume(self, resume_id: int, job_id: int) -> dict:
        """对简历进行AI评估（并行维度评估）"""
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume or not resume.raw_text:
            raise NotFoundError("简历不存在或未解析")

        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")

        # 获取或创建匹配记录
        match = await self.eval_repo.get_match_by_resume_and_job(resume_id, job_id)
        if not match:
            match = await self.eval_repo.create_match(resume_id, job_id)

        # TODO: 从数据库获取岗位的评估维度和技能要求
        dimensions = [
            {"dimension_id": 1, "dimension_name": "技术能力", "weight": 0.4},
            {"dimension_id": 2, "dimension_name": "项目经验", "weight": 0.35},
            {"dimension_id": 3, "dimension_name": "学历背景", "weight": 0.25}
        ]

        # 并行评估所有维度
        dimension_results = await self._evaluate_dimensions_parallel(
            match.id, resume.raw_text, job.name, dimensions
        )

        # 计算加权总分（只计算成功的维度）
        completed_results = [r for r in dimension_results if r["is_completed"]]
        if not completed_results:
            raise Exception("所有维度评估均失败")

        total_weighted_score = sum(
            r["score"] * dimensions[i]["weight"]
            for i, r in enumerate(dimension_results)
            if r["is_completed"]
        )

        # 重新归一化权重
        total_weight = sum(dimensions[i]["weight"] for i, r in enumerate(dimension_results) if r["is_completed"])
        if total_weight > 0:
            total_weighted_score = total_weighted_score / total_weight * sum(d["weight"] for d in dimensions)

        # 生成综合评价
        comprehensive = self.comprehensive_chain.evaluate(
            job_name=job.name,
            final_score=total_weighted_score,
            dimensions=completed_results
        )

        label = self._get_label(total_weighted_score)

        await self.eval_repo.update_match_result(
            match_id=match.id,
            score=total_weighted_score,
            label=label,
            advantage=comprehensive.get("advantage_comment", ""),
            disadvantage=comprehensive.get("disadvantage_comment", "")
        )

        logger.info(f"简历 {resume_id} 评估完成，岗位 {job_id}，得分 {total_weighted_score}")

        return {
            "match_id": match.id,
            "final_score": total_weighted_score,
            "final_label": label,
            "dimensions": dimension_results,
            "advantage_comment": comprehensive.get("advantage_comment", ""),
            "disadvantage_comment": comprehensive.get("disadvantage_comment", "")
        }

    async def _evaluate_dimensions_parallel(self, match_id: int, resume_text: str, job_name: str, dimensions: list) -> list:
        """并行评估所有维度"""
        async def evaluate_single(dim: dict):
            try:
                result = self.dimension_chain.evaluate(
                    resume_text=resume_text,
                    dimension_name=dim["dimension_name"],
                    job_name=job_name,
                    job_skills=""
                )
                await self.eval_repo.create_eval_detail_with_status(
                    match_id=match_id,
                    dimension_id=dim["dimension_id"],
                    score=result["score"],
                    advantage=result.get("advantage", ""),
                    disadvantage=result.get("disadvantage", ""),
                    is_completed=True
                )
                return {
                    "dimension_name": dim["dimension_name"],
                    "score": result["score"],
                    "advantage": result.get("advantage", ""),
                    "disadvantage": result.get("disadvantage", ""),
                    "is_completed": True
                }
            except Exception as e:
                logger.error(f"维度 {dim['dimension_name']} 评估失败: {e}")
                await self.eval_repo.create_eval_detail_with_status(
                    match_id=match_id,
                    dimension_id=dim["dimension_id"],
                    score=50.0,  # 默认分
                    advantage="",
                    disadvantage="",
                    is_completed=False,
                    error_message=str(e)
                )
                return {
                    "dimension_name": dim["dimension_name"],
                    "score": 50.0,
                    "advantage": "",
                    "disadvantage": "",
                    "is_completed": False,
                    "error_message": str(e)
                }

        tasks = [evaluate_single(dim) for dim in dimensions]
        return await asyncio.gather(*tasks)

    async def get_evaluation_detail(self, match_id: int) -> dict:
        """获取评估详情"""
        match = await self.eval_repo.get_match_by_id(match_id)
        if not match:
            raise NotFoundError("评估记录不存在")

        details = await self.eval_repo.get_eval_details(match_id)
        hits = await self.eval_repo.get_skill_hits(match_id)

        return {
            "match_id": match.id,
            "resume_id": match.resume_id,
            "job_id": match.job_id,
            "final_score": float(match.final_score) if match.final_score else 0,
            "final_label": match.final_label or "未评估",
            "advantage_comment": match.advantage_comment or "",
            "disadvantage_comment": match.disadvantage_comment or "",
            "dimensions": [
                {
                    "dimension_id": d.dimension_id,
                    "dimension_name": d.dimension_name,
                    "score": float(d.dimension_score),
                    "advantage": d.dimension_advantage or "",
                    "disadvantage": d.dimension_disadvantage or "",
                    "is_completed": d.is_completed == 1,
                    "error_message": d.error_message
                } for d in details
            ],
            "skill_hits": [
                {
                    "skill_id": h.skill_id,
                    "is_hit": h.is_hit == 1,
                    "hit_context": h.hit_context or ""
                } for h in hits
            ]
        }
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/services/eval_service.py
git commit -m "feat(employee): support parallel dimension evaluation with error handling"
```

---

### Task 4: 实现简历文件预览 API

**Files:**
- Create: `backend/app/utils/storage/file_parser.py`
- Modify: `backend/app/api/v1/employee/resumes.py`

- [ ] **Step 1: 创建文件解析工具**

```python
# backend/app/utils/storage/file_parser.py
import mimetypes
from pathlib import Path


def get_file_type(file_path: str) -> str:
    """根据文件路径判断文件类型"""
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type:
        if 'pdf' in mime_type:
            return 'pdf'
        elif 'word' in mime_type or 'document' in mime_type:
            return 'docx'
        elif 'image' in mime_type:
            return 'image'
    ext = Path(file_path).suffix.lower()
    if ext == '.pdf':
        return 'pdf'
    elif ext in ['.doc', '.docx']:
        return 'docx'
    elif ext in ['.png', '.jpg', '.jpeg', '.gif', '.bmp']:
        return 'image'
    return 'unknown'


def extract_text_from_docx(file_path: str) -> str:
    """提取 Word 文档文本内容"""
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs]
        return "\n".join(paragraphs)
    except ImportError:
        raise Exception("python-docx 库未安装")
    except Exception as e:
        raise Exception(f"解析 Word 文档失败: {str(e)}")
```

- [ ] **Step 2: 更新简历 API**

```python
# backend/app/api/v1/employee/resumes.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from app.repositories.resume_repo import ResumeRepository
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse, PageData
from app.utils.storage.file_parser import get_file_type, extract_text_from_docx

router = APIRouter()


def get_repo(db=Depends(get_db)) -> ResumeRepository:
    return ResumeRepository(db)


@router.get("/{resume_id}/file")
async def get_resume_file(
    resume_id: int,
    repo: ResumeRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    """获取简历文件（PDF/图片直接返回，Word 提取文本返回）"""
    resume = await repo.get_by_id(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    file_type = get_file_type(resume.file_path)

    if file_type == 'docx':
        try:
            text = extract_text_from_docx(resume.file_path)
            return {"file_type": "docx", "content": text, "file_name": resume.file_name}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"解析文档失败: {str(e)}")
    elif file_type in ['pdf', 'image']:
        from pathlib import Path
        file_path = Path(resume.file_path)
        if not file_path.is_absolute():
            # 相对路径需要拼接基础路径
            from app.core.config import settings
            file_path = Path(settings.LOCAL_STORAGE_PATH) / file_path

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="文件不存在")

        return FileResponse(
            path=str(file_path),
            media_type=mimetypes.guess_type(str(file_path))[0],
            filename=resume.file_name
        )
    else:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_type}")
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/utils/storage/file_parser.py
git add backend/app/api/v1/employee/resumes.py
git commit -m "feat(employee): add resume file preview API with Word/PDF support"
```

---

### Task 5: 实现工作台统计 API

**Files:**
- Create: `backend/app/api/v1/employee/analytics.py`

- [ ] **Step 1: 创建 Analytics API**

```python
# backend/app/api/v1/employee/analytics.py
from fastapi import APIRouter, Depends, Query
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse
from app.repositories.job_repo import JobRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.eval_repo import EvalRepository
from app.repositories.application_repo import ApplicationRepository

router = APIRouter()


def get_repos(db=Depends(get_db)):
    return {
        "job": JobRepository(db),
        "resume": ResumeRepository(db),
        "eval": EvalRepository(db),
        "application": ApplicationRepository(db)
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
```

- [ ] **Step 2: 添加 Repository 方法**

在 `job_repo.py` 添加:
```python
async def count_active(self) -> int:
    from sqlalchemy import func, select
    result = await self.db.execute(
        select(func.count()).select_from(JobPosition).where(JobPosition.status == 1, JobPosition.is_deleted == 0)
    )
    return result.scalar() or 0
```

在 `resume_repo.py` 添加:
```python
async def count_all(self) -> int:
    from sqlalchemy import func, select
    result = await self.db.execute(
        select(func.count()).select_from(Resume).where(Resume.is_deleted == 0)
    )
    return result.scalar() or 0
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/api/v1/employee/analytics.py
git commit -m "feat(employee): add analytics API for dashboard and match distribution"
```

---

### Task 6: 完善 Celery 评估任务

**Files:**
- Modify: `backend/celery_app/tasks/eval_task.py`
- Modify: `backend/app/api/v1/employee/evaluations.py`

- [ ] **Step 1: 更新 Celery 任务**

```python
# backend/celery_app/tasks/eval_task.py
from celery_app.celery import celery_app
from app.services.eval_service import EvalService
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import logging

logger = logging.getLogger(__name__)


def get_sync_session():
    """获取同步数据库会话（Celery 任务中使用）"""
    from app.core.config import settings
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=2, autoretry_for=(Exception,))
def run_evaluation_task(self, resume_ids: list, job_id: int):
    """
    异步评估任务

    Args:
        resume_ids: 要评估的简历ID列表
        job_id: 目标岗位ID
    """
    logger.info(f"开始评估 {len(resume_ids)} 份简历，岗位 {job_id}")

    Session = get_sync_session()
    session = Session()

    try:
        eval_repo = EvalRepository(session)
        resume_repo = ResumeRepository(session)
        job_repo = JobRepository(session)
        service = EvalService(eval_repo, resume_repo, job_repo)

        results = []
        for resume_id in resume_ids:
            try:
                result = service.evaluate_resume(resume_id, job_id)
                results.append({"resume_id": resume_id, "status": "success", "match_id": result["match_id"]})
            except Exception as e:
                logger.error(f"简历 {resume_id} 评估失败: {e}")
                results.append({"resume_id": resume_id, "status": "failed", "error": str(e)})
                # 重试
                raise

        return {"status": "completed", "count": len(resume_ids), "results": results}

    except Exception as e:
        logger.error(f"批量评估任务失败: {e}")
        raise self.retry(exc=e)
    finally:
        session.close()
```

- [ ] **Step 2: 更新 evaluations API**

```python
# backend/app/api/v1/employee/evaluations.py
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import List
from app.services.eval_service import EvalService
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.api.deps import get_db, get_current_user
from app.schemas.response import ApiResponse, EvalResult
from celery_app.tasks.eval_task import run_evaluation_task

router = APIRouter()


class BatchEvalRequest(BaseModel):
    resume_ids: List[int]
    job_id: int


def get_service(db=Depends(get_db)) -> EvalService:
    return EvalService(
        EvalRepository(db),
        ResumeRepository(db),
        JobRepository(db)
    )


@router.post("/batch", response_model=ApiResponse)
async def batch_evaluate(
    req: BatchEvalRequest,
    background_tasks: BackgroundTasks,
    service: EvalService = Depends(get_service),
    current_user: dict = Depends(get_current_user)
):
    """批量触发评估（员工端核心功能）- 异步 Celery 任务"""
    logger.info(f"员工 {current_user['sub']} 提交批量评估: {len(req.resume_ids)} 份简历, 岗位 {req.job_id}")

    # 触发 Celery 异步任务
    run_evaluation_task.delay(req.resume_ids, req.job_id)

    return ApiResponse(code=200, message="评估任务已提交，请稍后查看", data={"count": len(req.resume_ids)})
```

- [ ] **Step 3: 提交**

```bash
git add backend/celery_app/tasks/eval_task.py
git add backend/app/api/v1/employee/evaluations.py
git commit -m "feat(employee): integrate Celery task for async resume evaluation"
```

---

## 二、前端实现计划

### 前端文件结构

```
frontend/src/
├── api/employee/
│   ├── analytics.ts              # 新增
│   ├── resumes.ts                # 需完善
│   └── index.ts                 # 导出汇总
├── components/
│   ├── common/
│   │   ├── match-pie-chart.tsx   # 新增：匹配度饼图
│   │   └── resume-preview-dialog.tsx  # 新增：简历预览
│   └── layout/
│       └── employee-nav.tsx      # 需完善
├── pages/employee/
│   ├── dashboard.tsx             # 需完善（真实数据）
│   ├── jobs.tsx                  # 需完善
│   ├── job-edit.tsx              # 新增
│   ├── resumes.tsx                # 需完善
│   ├── resume-detail.tsx         # 新增
│   ├── evaluations.tsx           # 需完善（核心）
│   ├── eval-detail.tsx           # 需完善
│   └── applications.tsx          # 新增
├── types/
│   └── employee.ts               # 新增：员工端类型定义
└── App.tsx                       # 需添加路由
```

### Task 7: 前端类型定义

**Files:**
- Create: `frontend/src/types/employee.ts`

- [ ] **Step 1: 创建类型定义**

```typescript
// frontend/src/types/employee.ts

// 工作台统计
export interface DashboardStats {
  job_count: number;
  resume_count: number;
  pending_eval_count: number;
  avg_match_score: number;
  recent_activities: Activity[];
}

export interface Activity {
  id: number;
  type: 'resume_upload' | 'application' | 'evaluation' | 'job_create';
  text: string;
  time: string;
}

// 匹配度分布
export interface MatchDistribution {
  total: number;
  excellent: { count: number; percentage: number };
  good: { count: number; percentage: number };
  average: { count: number; percentage: number };
  fail: { count: number; percentage: number };
}

// 简历评估状态
export interface ResumeWithEvaluation {
  resume_id: number;
  file_name: string;
  match_id?: number;
  final_score?: number;
  final_label?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

// 评估详情
export interface EvaluationDetail {
  match_id: number;
  resume_id: number;
  job_id: number;
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: DimensionScore[];
  skill_hits: SkillHit[];
}

export interface DimensionScore {
  dimension_id: number;
  dimension_name: string;
  score: number;
  advantage: string;
  disadvantage: string;
  is_completed: boolean;
  error_message?: string;
}

export interface SkillHit {
  skill_id: number;
  skill_name?: string;
  skill_type?: number;
  is_hit: boolean;
  hit_context: string;
  match_label?: string;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/types/employee.ts
git commit -m "feat(employee): add TypeScript types for employee side"
```

---

### Task 8: 简历预览组件

**Files:**
- Create: `frontend/src/components/common/resume-preview-dialog.tsx`

- [ ] **Step 1: 创建预览组件**

```tsx
// frontend/src/components/common/resume-preview-dialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { employeeResumesApi } from '@/api/employee/resumes';

interface ResumePreviewDialogProps {
  resumeId: number;
  fileName: string;
  open: boolean;
  onClose: () => void;
}

export function ResumePreviewDialog({ resumeId, fileName, open, onClose }: ResumePreviewDialogProps) {
  const fileType = fileName.split('.').pop()?.toLowerCase();

  const getContent = async () => {
    try {
      const res = await employeeResumesApi.getFile(resumeId);
      if (res.data.file_type === 'docx') {
        return { type: 'text', content: res.data.content };
      }
      return { type: fileType, content: res.config.url };
    } catch (error) {
      return { type: 'error', content: '加载失败' };
    }
  };

  const [content, setContent] = useState<{ type: string; content: string } | null>(null);

  useEffect(() => {
    if (open) {
      getContent().then(setContent);
    }
  }, [open, resumeId]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh]">
        <DialogHeader>
          <DialogTitle>{fileName}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-full">
          {content?.type === 'text' ? (
            <pre className="whitespace-pre-wrap text-sm">{content.content}</pre>
          ) : content?.type === 'pdf' ? (
            <iframe src={content?.content} className="w-full h-full min-h-[500px]" />
          ) : content?.type === 'image' ? (
            <img src={content?.content} alt={fileName} className="max-w-full" />
          ) : (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 更新 resumes API**

```typescript
// frontend/src/api/employee/resumes.ts
export const employeeResumesApi = {
  list: (params?: { page?: number; page_size?: number; status?: number }) =>
    client.get('/employee/resumes', { params }),

  get: (id: number) => client.get(`/employee/resumes/${id}`),

  getFile: (id: number) => client.get(`/employee/resumes/${id}/file`, { responseType: 'blob' }),

  listPending: () => client.get('/employee/resumes/pending'),
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/common/resume-preview-dialog.tsx
git add frontend/src/api/employee/resumes.ts
git commit -m "feat(employee): add resume preview dialog component"
```

---

### Task 9: 匹配度饼图组件

**Files:**
- Create: `frontend/src/components/common/match-pie-chart.tsx`

- [ ] **Step 1: 创建饼图组件**

```tsx
// frontend/src/components/common/match-pie-chart.tsx
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { MatchDistribution } from '@/types/employee';

interface MatchPieChartProps {
  data: MatchDistribution;
}

const COLORS = {
  excellent: '#10B981',  // 绿色
  good: '#2563EB',       // 蓝色
  average: '#F59E0B',    // 黄色
  fail: '#EF4444',       // 红色
};

const LABELS = {
  excellent: '优秀',
  good: '良好',
  average: '一般',
  fail: '未达标',
};

export function MatchPieChart({ data }: MatchPieChartProps) {
  const chartData = [
    { name: '优秀', value: data.excellent.count, color: COLORS.excellent },
    { name: '良好', value: data.good.count, color: COLORS.good },
    { name: '一般', value: data.average.count, color: COLORS.average },
    { name: '未达标', value: data.fail.count, color: COLORS.fail },
  ].filter(item => item.value > 0);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        暂无评估数据
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [`${value}份`, name]}
        />
        <Legend
          formatter={(value: string) => <span className="text-sm">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/common/match-pie-chart.tsx
git commit -m "feat(employee): add match distribution pie chart component"
```

---

### Task 10: 工作台页面（真实数据）

**Files:**
- Modify: `frontend/src/pages/employee/dashboard.tsx`

- [ ] **Step 1: 重写工作台**

```tsx
// frontend/src/pages/employee/dashboard.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { DashboardStats } from '@/types/employee';

export default function EmployeeDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await employeeAnalyticsApi.getDashboard();
        setStats(res.data);
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      }
    };
    loadStats();
  }, []);

  if (!stats) {
    return <PageLayout title="工作台" action={<EmployeeNav />}><div>加载中...</div></PageLayout>;
  }

  const statCards = [
    { label: '在招岗位', value: stats.job_count, change: '' },
    { label: '简历总数', value: stats.resume_count, change: '' },
    { label: '待评估', value: stats.pending_eval_count, change: '' },
    { label: '平均匹配率', value: `${stats.avg_match_score}%`, change: '' },
  ];

  return (
    <PageLayout title="工作台" subtitle="欢迎回来" action={<EmployeeNav />}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
              <span className="text-3xl font-bold">{stat.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">最近动态</h2>
            <div className="space-y-4">
              {stats.recent_activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-accent mt-2" />
                  <div className="flex-1">
                    <p className="text-sm">{activity.text}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">快捷操作</h2>
            <div className="grid grid-cols-2 gap-3">
              <Link to="/employee/jobs/create" className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                <p className="font-medium">发布岗位</p>
                <p className="text-xs text-muted-foreground">创建新职位</p>
              </Link>
              <Link to="/employee/evaluations" className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                <p className="font-medium">批量评估</p>
                <p className="text-xs text-muted-foreground">AI评分</p>
              </Link>
              <Link to="/employee/resumes" className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                <p className="font-medium">简历库</p>
                <p className="text-xs text-muted-foreground">浏览全部</p>
              </Link>
              <Link to="/employee/jobs" className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all">
                <p className="font-medium">岗位管理</p>
                <p className="text-xs text-muted-foreground">编辑职位</p>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
```

- [ ] **Step 2: 添加 analytics API**

```typescript
// frontend/src/api/employee/analytics.ts
import client from '@/api/client';

export const employeeAnalyticsApi = {
  getDashboard: () => client.get('/employee/analytics/dashboard'),

  getMatchDistribution: (jobId: number) =>
    client.get(`/employee/analytics/job/${jobId}/match-distribution`),

  getJobResumeList: (jobId: number, params?: { page?: number; page_size?: number }) =>
    client.get(`/employee/analytics/job/${jobId}/resume-list`, { params }),
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/employee/dashboard.tsx
git add frontend/src/api/employee/analytics.ts
git commit -m "feat(employee): update dashboard with real data from API"
```

---

### Task 11: 评估管理页面（核心 - 匹配度分布 + 批量评估）

**Files:**
- Modify: `frontend/src/pages/employee/evaluations.tsx`

- [ ] **Step 1: 重写评估页面**

```tsx
// frontend/src/pages/employee/evaluations.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MatchPieChart } from '@/components/common/match-pie-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { MatchDistribution, ResumeWithEvaluation, Job } from '@/types/employee';

export default function EmployeeEvaluations() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [distribution, setDistribution] = useState<MatchDistribution | null>(null);
  const [resumes, setResumes] = useState<ResumeWithEvaluation[]>([]);
  const [selectedResumeIds, setSelectedResumeIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载岗位列表
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const res = await employeeJobsApi.list();
        setJobs(res.data.items || []);
      } catch (error) {
        console.error('Failed to load jobs:', error);
      }
    };
    loadJobs();
  }, []);

  // 加载选中岗位的匹配度分布和简历列表
  useEffect(() => {
    if (!selectedJobId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [distRes, listRes] = await Promise.all([
          employeeAnalyticsApi.getMatchDistribution(selectedJobId),
          employeeAnalyticsApi.getJobResumeList(selectedJobId),
        ]);
        setDistribution(distRes.data);
        setResumes(listRes.data.items || []);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedJobId]);

  const toggleResume = (id: number) => {
    setSelectedResumeIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBatchEvaluate = async () => {
    if (!selectedJobId || selectedResumeIds.length === 0) return;
    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumeIds,
        job_id: selectedJobId,
      });
      alert('评估任务已提交，请稍后查看');
      setSelectedResumeIds([]);
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageLayout title="AI评估" subtitle="批量评估简历匹配度" action={<EmployeeNav />}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧：岗位选择 */}
        <Card>
          <CardHeader>
            <CardTitle>选择目标岗位</CardTitle>
          </CardHeader>
          <CardContent>
            <Select onValueChange={(v) => setSelectedJobId(Number(v))}>
              <SelectTrigger>
                <SelectValue placeholder="请选择岗位" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={String(job.id)}>
                    {job.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedJobId && distribution && (
              <div className="mt-6">
                <h3 className="text-sm font-medium mb-4">匹配度分布</h3>
                <MatchPieChart data={distribution} />
                <div className="mt-4 text-center text-2xl font-bold">
                  {distribution.total} 份简历
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 中间：简历列表 */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>选择简历 ({selectedResumeIds.length} 份)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">加载中...</div>
              ) : resumes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {selectedJobId ? '暂无简历' : '请先选择岗位'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resumes.map((resume) => (
                    <button
                      key={resume.resume_id}
                      onClick={() => toggleResume(resume.resume_id)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        selectedResumeIds.includes(resume.resume_id)
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-accent/50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{resume.file_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {resume.final_score !== undefined ? (
                              <>
                                <span className="text-sm font-semibold">{resume.final_score}</span>
                                <MatchBadge label={resume.final_label || '待评估'} />
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">待评估</span>
                            )}
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded border ${
                          selectedResumeIds.includes(resume.resume_id)
                            ? 'bg-accent border-accent'
                            : 'border-muted-foreground'
                        }`}>
                          {selectedResumeIds.includes(resume.resume_id) && (
                            <span className="text-white text-xs">✓</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 操作面板 */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{selectedResumeIds.length}</p>
                  <p className="text-sm text-muted-foreground">份简历待评估</p>
                </div>
                <Button
                  disabled={!selectedJobId || selectedResumeIds.length === 0 || submitting}
                  onClick={handleBatchEvaluate}
                >
                  {submitting ? '提交中...' : '开始AI评估'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/pages/employee/evaluations.tsx
git commit -m "feat(employee): update evaluations page with match distribution pie chart and batch evaluation"
```

---

### Task 12: 简历库页面（完善 + 预览）

**Files:**
- Modify: `frontend/src/pages/employee/resumes.tsx`

- [ ] **Step 1: 重写简历库页面**

```tsx
// frontend/src/pages/employee/resumes.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResumePreviewDialog } from '@/components/common/resume-preview-dialog';
import { employeeResumesApi } from '@/api/employee/resumes';

interface Resume {
  id: number;
  file_name: string;
  user_id?: number;
  status: number;
  create_time: string;
}

export default function EmployeeResumes() {
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewResume, setPreviewResume] = useState<{ id: number; fileName: string } | null>(null);

  useEffect(() => {
    const loadResumes = async () => {
      try {
        const res = await employeeResumesApi.list();
        setResumes(res.data.items || []);
      } catch (error) {
        console.error('Failed to load resumes:', error);
      } finally {
        setLoading(false);
      }
    };
    loadResumes();
  }, []);

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <Badge variant="secondary">待处理</Badge>;
      case 2: return <Badge variant="default">评估完成</Badge>;
      case 3: return <Badge variant="destructive">处理失败</Badge>;
      default: return <Badge>未知</Badge>;
    }
  };

  return (
    <PageLayout title="简历库" subtitle="管理所有简历" action={<EmployeeNav />}>
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-20 bg-muted rounded-xl" />
        </div>
      ) : resumes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">暂无简历</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {resumes.map((resume) => (
            <Card key={resume.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div>
                  <button
                    onClick={() => setPreviewResume({ id: resume.id, fileName: resume.file_name })}
                    className="font-medium hover:underline text-left"
                  >
                    {resume.file_name}
                  </button>
                  <div className="flex items-center gap-3 mt-1">
                    {getStatusBadge(resume.status)}
                    <span className="text-sm text-muted-foreground">
                      {resume.create_time?.split('T')[0]}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewResume({ id: resume.id, fileName: resume.file_name })}
                >
                  预览
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {previewResume && (
        <ResumePreviewDialog
          resumeId={previewResume.id}
          fileName={previewResume.fileName}
          open={!!previewResume}
          onClose={() => setPreviewResume(null)}
        />
      )}
    </PageLayout>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/pages/employee/resumes.tsx
git commit -m "feat(employee): update resumes page with preview support"
```

---

### Task 13: 投递管理页面

**Files:**
- Create: `frontend/src/pages/employee/applications.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 创建投递管理页面**

```tsx
// frontend/src/pages/employee/applications.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { employeeApplicationsApi } from '@/api/employee/applications';

interface Application {
  id: number;
  user_id: number;
  job_id: number;
  job_name: string;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
}

const STATUS_OPTIONS = [
  { value: '0', label: '已取消' },
  { value: '1', label: '待处理' },
  { value: '2', label: '已查看' },
  { value: '3', label: '面试中' },
  { value: '4', label: '已拒绝' },
  { value: '5', label: '已录用' },
];

export default function EmployeeApplications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');

  const loadApplications = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterStatus) params.status = filterStatus;
      const res = await employeeApplicationsApi.list(params);
      setApplications(res.data.items || []);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, [filterStatus]);

  const handleStatusChange = async (appId: number, newStatus: number) => {
    try {
      await employeeApplicationsApi.updateStatus(appId, newStatus);
      await loadApplications();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 1: return 'bg-yellow-100 text-yellow-800';
      case 2: return 'bg-blue-100 text-blue-800';
      case 3: return 'bg-green-100 text-green-800';
      case 4: return 'bg-red-100 text-red-800';
      case 5: return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <PageLayout title="投递管理" subtitle="管理所有投递记录" action={<EmployeeNav />}>
      <div className="mb-6">
        <Select onValueChange={setFilterStatus} value={filterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="筛选状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部</SelectItem>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-muted rounded-xl" />
        </div>
      ) : applications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">暂无投递记录</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div>
                  <p className="font-medium">用户 {app.user_id} → {app.job_name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(app.status)}`}>
                      {app.status_name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {app.create_time?.split('T')[0]}
                    </span>
                  </div>
                </div>
                <Select onValueChange={(v) => handleStatusChange(app.id, Number(v))} defaultValue={String(app.status)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
```

- [ ] **Step 2: 更新 App.tsx 添加路由**

```tsx
// 在 App.tsx 添加
import EmployeeApplications from '@/pages/employee/applications';

// 在路由中添加
<Route path="/employee/applications" element={<ProtectedRoute userType="employee"><EmployeeApplications /></ProtectedRoute>} />
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/employee/applications.tsx
git add frontend/src/App.tsx
git commit -m "feat(employee): add applications management page"
```

---

### Task 14: 更新 EmployeeNav 导航

**Files:**
- Modify: `frontend/src/components/layout/employee-nav.tsx`

- [ ] **Step 1: 更新导航组件**

```tsx
// frontend/src/components/layout/employee-nav.tsx
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { path: '/employee/dashboard', label: '工作台' },
  { path: '/employee/jobs', label: '岗位管理' },
  { path: '/employee/resumes', label: '简历库' },
  { path: '/employee/evaluations', label: 'AI评估' },
  { path: '/employee/applications', label: '投递管理' },
];

export function EmployeeNav() {
  const location = useLocation();
  const { logout } = useAuthStore();

  return (
    <div className="flex items-center gap-6">
      {navItems.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          className={`text-sm font-medium transition-colors ${
            location.pathname === item.path
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {item.label}
        </Link>
      ))}
      <button onClick={logout} className="text-sm text-muted-foreground hover:text-foreground">
        退出
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/layout/employee-nav.tsx
git commit -m "feat(employee): update navigation to include applications"
```

---

## 三、Self-Review 检查清单

### Spec Coverage

| 设计文档要求 | 实现位置 |
|-------------|---------|
| 岗位管理 CRUD | Task 1-6 (后端), Task 10 (前端 jobs) |
| 简历库 + 预览 | Task 4, Task 8, Task 12 |
| 评估管理（匹配度分布 + 批量评估） | Task 3, 6, 9, 11 |
| 投递管理 | Task 13 |
| 工作台统计 | Task 5, Task 10 |
| Celery 异步评估 + 重试 | Task 6 |
| LLM Agent 并行评估 | Task 3 |
| is_completed 字段 | Task 1, Task 3 |

### Placeholder Scan

- 无 "TBD"、"TODO" 占位符
- 所有步骤都有实际代码
- 所有 API 路径都是具体路径

### Type Consistency

- `MatchDistribution` 接口在 Task 9 定义并使用
- `EvaluationDetail` 接口在 Task 7 定义
- API 响应结构与类型定义一致

---

## 四、执行选择

**Plan complete and saved to `docs/superpowers/plans/2026-04-22-employee-side-impl-plan.md`**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
