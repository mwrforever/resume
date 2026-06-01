"""Agent 文件附件上传兼容测试。"""

import pytest

from app.services.agent_resume_pipeline_service import AgentResumePipelineService
from app.services.agent_service import AgentService


class _ResumeRecord:
    """测试用简历记录。"""

    id = 11
    file_name = "candidate.pdf"
    file_path = "2026-05-27/candidate.pdf"
    raw_text = "候选人简历正文"


class _ResumeRepository:
    """测试用简历仓储。"""

    async def get_by_id(self, resume_id: int):
        """按 ID 返回测试简历。"""
        return _ResumeRecord() if resume_id == 11 else None


class _JobRepository:
    """测试用岗位仓储，记录是否触发岗位校验。"""

    def __init__(self) -> None:
        """初始化调用计数。"""
        self.get_by_id_calls = 0

    async def get_by_id(self, job_id: int):
        """记录岗位查询调用。"""
        self.get_by_id_calls += 1
        return None


@pytest.mark.asyncio
async def test_load_resume_context_allows_missing_job_id_without_job_lookup() -> None:
    """文件附件不再依赖岗位下拉，缺少 job_id 时也应能加载简历上下文。"""
    job_repo = _JobRepository()
    pipeline = AgentResumePipelineService(_ResumeRepository(), job_repo)

    context = await pipeline.load_resume_context(resume_id=11, job_id=None, employee_id=7)

    assert context.resume_id == 11
    assert context.job_id is None
    assert context.file_name == "candidate.pdf"
    assert job_repo.get_by_id_calls == 0


def test_parse_resume_ref_allows_missing_job_id() -> None:
    """Agent 消息引用文件附件时，job_id 可为空。"""
    resume_ref = AgentService._parse_resume_ref([
        {"type": "resume", "resume_id": 11, "file_name": "candidate.pdf"},
    ])

    assert resume_ref == {"resume_id": 11, "job_id": None, "file_name": "candidate.pdf"}
