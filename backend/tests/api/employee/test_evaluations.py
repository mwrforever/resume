"""
TDD Tests for Employee Evaluations API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_batch_evaluation_triggers_for_applications(
    client: AsyncClient,
    employee_headers: dict,
    monkeypatch: pytest.MonkeyPatch
):
    """Test that batch evaluation triggers evaluation for specified applications"""
    from app.main import app
    from app.modules.evaluation import router as evaluations

    validated_ids = []
    dispatched_args = []

    class FakeEvalService:
        async def validate_batch_applications(self, application_ids: list[int]) -> None:
            validated_ids.extend(application_ids)

    def fake_apply_async(args: tuple, ignore_result: bool) -> None:
        dispatched_args.append((args, ignore_result))

    app.dependency_overrides[evaluations.get_service] = lambda: FakeEvalService()
    monkeypatch.setattr(evaluations.run_evaluation_task, "apply_async", fake_apply_async)

    # Submit batch evaluation request
    response = await client.post(
        "/api/v1/employee/evaluations/batch",
        json={"application_ids": [1, 2, 3]},
        headers=employee_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert "count" in data["data"]
    assert data["data"]["count"] == 3
    assert validated_ids == [1, 2, 3]
    assert dispatched_args == [(([1, 2, 3],), True)]


@pytest.mark.asyncio
async def test_get_evaluation_detail_returns_result(
    client: AsyncClient,
    employee_headers: dict
):
    """Test that getting evaluation detail returns evaluation result"""
    from app.main import app
    from app.modules.evaluation import router as evaluations

    class FakeEvalService:
        async def get_evaluation_detail(self, match_id: int) -> dict:
            return {
                "match_id": match_id,
                "application_id": 10,
                "resume_id": 20,
                "job_id": 30,
                "final_score": 88.0,
                "final_label": "良好",
                "advantage_comment": "优势",
                "disadvantage_comment": "",
                "dimensions": [],
                "skill_hits": [],
            }

    app.dependency_overrides[evaluations.get_service] = lambda: FakeEvalService()

    response = await client.get(
        "/api/v1/employee/evaluations/1",
        headers=employee_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert data["data"]["match_id"] == 1
    assert data["data"]["application_id"] == 10
    assert data["data"]["final_score"] == 88.0


@pytest.mark.asyncio
async def test_evaluations_require_auth(client: AsyncClient):
    """Test that evaluation endpoints require authentication"""
    response = await client.post(
        "/api/v1/employee/evaluations/batch",
        json={"application_ids": [1]}
    )
    assert response.status_code == 401

    response = await client.get("/api/v1/employee/evaluations/1")
    assert response.status_code == 401
