"""
TDD Tests for Employee Jobs API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_job_returns_job_id(client: AsyncClient, employee_headers: dict):
    """Test that creating a job returns a job id"""
    response = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Test Job", "description": "Test Description"},
        headers=employee_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert "id" in data["data"]
    assert isinstance(data["data"]["id"], int)


@pytest.mark.asyncio
async def test_create_job_requires_auth(client: AsyncClient):
    """Test that creating a job without auth returns 422 (missing required header)"""
    response = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Test Job", "description": "Test Description"}
    )
    # FastAPI returns 422 for missing required Header parameter
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_employee_jobs_returns_only_own_jobs(
    client: AsyncClient,
    employee_headers: dict,
    employee2_headers: dict
):
    """Test that employee only sees their own jobs"""
    # Create job as employee 1
    create_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Employee1 Job", "description": "Test"},
        headers=employee_headers
    )
    assert create_resp.status_code == 200

    # Create job as employee 2
    create_resp2 = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Employee2 Job", "description": "Test"},
        headers=employee2_headers
    )
    assert create_resp2.status_code == 200

    # List jobs as employee 1 - should only see Employee1 Job
    list_resp = await client.get("/api/v1/employee/jobs", headers=employee_headers)
    assert list_resp.status_code == 200
    data = list_resp.json()
    job_names = [item["name"] for item in data["data"]["items"]]
    assert "Employee1 Job" in job_names
    assert "Employee2 Job" not in job_names


@pytest.mark.asyncio
async def test_update_job_modifies_fields(client: AsyncClient, employee_headers: dict):
    """Test that updating a job modifies the fields"""
    # Create a job
    create_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Original Name", "description": "Original Desc"},
        headers=employee_headers
    )
    job_id = create_resp.json()["data"]["id"]

    # Update the job
    update_resp = await client.put(
        f"/api/v1/employee/jobs/{job_id}",
        json={"name": "Updated Name", "description": "Updated Desc"},
        headers=employee_headers
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["code"] == 200

    # Verify the update
    list_resp = await client.get("/api/v1/employee/jobs", headers=employee_headers)
    jobs = list_resp.json()["data"]["items"]
    updated_job = next((j for j in jobs if j["id"] == job_id), None)
    assert updated_job is not None
    assert updated_job["name"] == "Updated Name"
    assert updated_job["description"] == "Updated Desc"


@pytest.mark.asyncio
async def test_delete_job_removes_from_list(client: AsyncClient, employee_headers: dict):
    """Test that deleting a job removes it from the list"""
    # Create a job
    create_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Job To Delete", "description": "Test"},
        headers=employee_headers
    )
    job_id = create_resp.json()["data"]["id"]

    # Verify job exists
    list_resp = await client.get("/api/v1/employee/jobs", headers=employee_headers)
    jobs = list_resp.json()["data"]["items"]
    assert any(j["id"] == job_id for j in jobs)

    # Delete the job
    delete_resp = await client.delete(f"/api/v1/employee/jobs/{job_id}", headers=employee_headers)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["code"] == 200

    # Verify job is removed
    list_resp = await client.get("/api/v1/employee/jobs", headers=employee_headers)
    jobs = list_resp.json()["data"]["items"]
    assert not any(j["id"] == job_id for j in jobs)
