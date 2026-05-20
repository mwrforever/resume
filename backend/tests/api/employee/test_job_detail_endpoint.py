from datetime import datetime
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.job import get_employee_job


class FakeJobRepository:
    async def get_by_id_with_dept(self, job_id: int):
        job = SimpleNamespace(
            id=job_id,
            name="岗位详情测试",
            description="岗位描述",
            dept_id=1,
            template_id=None,
            status=2,
            create_time=datetime.now(),
        )
        dept = SimpleNamespace(dept_name="研发部", dept_code="RD")
        return job, dept

    async def count_applications(self, job_id: int) -> int:
        return 0


class FakeJobService:
    def __init__(self) -> None:
        self.job_repo = FakeJobRepository()


class FakeTemplateRepository:
    async def get_template_detail(self, template_id: int):
        return {}


class FakeTemplateService:
    def __init__(self) -> None:
        self.repo = FakeTemplateRepository()


@pytest.mark.asyncio
async def test_get_employee_job_detail_builds_response_without_500():
    response = await get_employee_job(
        job_id=1,
        service=FakeJobService(),
        template_service=FakeTemplateService(),
        current_user={"sub": "1"},
    )

    assert response.code == 200
    assert response.data["id"] == 1
    assert response.data["dept_name"] == "研发部"
    assert response.data["resume_count"] == 0
    assert response.data["dimensions"] == []
    assert response.data["skills"] == []
    assert response.data["tags"] == []
