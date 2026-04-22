"""
TDD Tests for Employee Applications API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_applications_filters_by_job_id(
    client: AsyncClient,
    employee_headers: dict,
    user_headers: dict
):
    """Test that listing applications filters by job_id"""
    # Create a job as employee
    job_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Filter Test Job", "description": "Test"},
        headers=employee_headers
    )
    job_id = job_resp.json()["data"]["id"]

    # User applies to the job
    await client.post(
        "/api/v1/user/applications",
        json={"job_id": job_id, "resume_id": 1},
        headers=user_headers
    )

    # Employee lists applications filtered by job_id
    response = await client.get(
        f"/api/v1/employee/applications?job_id={job_id}",
        headers=employee_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert "items" in data["data"]
    # Verify all applications are for the correct job
    for item in data["data"]["items"]:
        assert item["job_id"] == job_id


@pytest.mark.asyncio
async def test_update_application_status_changes_state(
    client: AsyncClient,
    employee_headers: dict,
    user_headers: dict
):
    """Test that updating application status changes the state"""
    # Create a job as employee
    job_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "name": "Status Test Job", "description": "Test"},
        headers=employee_headers
    )
    job_id = job_resp.json()["data"]["id"]

    # User applies to the job
    app_resp = await client.post(
        "/api/v1/user/applications",
        json={"job_id": job_id, "resume_id": 1},
        headers=user_headers
    )
    app_id = app_resp.json()["data"]["id"]

    # Employee updates the application status
    response = await client.put(
        f"/api/v1/employee/applications/{app_id}/status?status=2",
        headers=employee_headers
    )
    assert response.status_code == 200
    assert response.json()["code"] == 200

    # Verify the status was updated by listing applications
    list_resp = await client.get(
        f"/api/v1/employee/applications?job_id={job_id}",
        headers=employee_headers
    )
    apps = list_resp.json()["data"]["items"]
    updated_app = next((a for a in apps if a["id"] == app_id), None)
    assert updated_app is not None
    assert updated_app["status"] == 2
