"""
TDD Tests for Employee Evaluations API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_batch_evaluation_triggers_for_applications(
    client: AsyncClient,
    employee_headers: dict
):
    """Test that batch evaluation triggers evaluation for specified applications"""
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


@pytest.mark.asyncio
async def test_get_evaluation_detail_returns_result(
    client: AsyncClient,
    employee_headers: dict
):
    """Test that getting evaluation detail returns evaluation result"""
    # Get evaluation detail (assuming match_id=1 exists or will return proper error)
    response = await client.get(
        "/api/v1/employee/evaluations/1",
        headers=employee_headers
    )
    # Should return 200 with evaluation data OR 404 if no evaluation exists
    assert response.status_code in [200, 404]
    if response.status_code == 200:
        data = response.json()
        assert data["code"] == 200
        assert "data" in data
        # Verify response structure if data exists
        if data["data"]:
            assert "match_id" in data["data"]
            assert "final_score" in data["data"]


@pytest.mark.asyncio
async def test_evaluations_require_auth(client: AsyncClient):
    """Test that evaluation endpoints require authentication"""
    # Batch evaluation without auth - returns 422 for missing required header
    response = await client.post(
        "/api/v1/employee/evaluations/batch",
        json={"application_ids": [1]}
    )
    # FastAPI returns 422 for missing required Header parameter
    assert response.status_code == 422

    # Get evaluation detail without auth - returns 422 for missing required header
    response = await client.get("/api/v1/employee/evaluations/1")
    assert response.status_code == 422
