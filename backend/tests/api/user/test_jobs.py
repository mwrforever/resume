"""
TDD Tests for User Jobs API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_jobs_returns_paginated_results(client: AsyncClient, employee_headers: dict):
    """Test that listing jobs returns paginated results with proper structure"""
    # First create some jobs as employee
    for i in range(3):
        await client.post(
            "/api/v1/employee/jobs",
            json={"dept_id": 1, "name": f"Job {i}", "description": f"Description {i}"},
            headers=employee_headers
        )

    # List jobs as user (public endpoint)
    response = await client.get("/api/v1/user/jobs?page=1&page_size=2")
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert "total" in data["data"]
    assert "items" in data["data"]
    assert isinstance(data["data"]["items"], list)
    assert len(data["data"]["items"]) <= 2


@pytest.mark.asyncio
async def test_list_jobs_excludes_inactive(client: AsyncClient, employee_headers: dict):
    """Test that inactive jobs are excluded from user listing"""
    # Create a job
    create_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Active Job", "description": "Test"},
        headers=employee_headers
    )
    job_id = create_resp.json()["data"]["id"]

    # List jobs - should see the active job
    list_resp = await client.get("/api/v1/user/jobs")
    jobs = list_resp.json()["data"]["items"]
    active_job_ids = [j["id"] for j in jobs if j.get("status") == 1]
    assert job_id in active_job_ids


@pytest.mark.asyncio
async def test_get_job_detail_returns_job_info(client: AsyncClient, employee_headers: dict):
    """Test that getting job detail returns complete job information"""
    # Create a job as employee
    create_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Detail Test Job", "description": "Test Description"},
        headers=employee_headers
    )
    job_id = create_resp.json()["data"]["id"]

    # Get job detail as user
    response = await client.get(f"/api/v1/user/jobs/{job_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert data["data"]["id"] == job_id
    assert data["data"]["name"] == "Detail Test Job"
    assert data["data"]["description"] == "Test Description"
