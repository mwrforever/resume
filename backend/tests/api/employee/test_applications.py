"""
TDD Tests for Employee Applications API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient


async def create_published_job(client: AsyncClient, employee_headers: dict, name: str) -> int:
    dimension_resp = await client.post(
        "/api/v1/employee/eval-dimensions",
        json={"dimension_name": f"{name} Dimension", "default_prompt_template": "Evaluate {resume_text} for {job_name}", "status": 1},
        headers=employee_headers,
    )
    dimension_id = dimension_resp.json()["data"]["id"]

    template_resp = await client.post(
        "/api/v1/employee/eval-templates",
        json={
            "template_name": f"{name} Template",
            "description": "Test template",
            "status": 1,
            "dimensions": [{"dimension_id": dimension_id, "weight": 1.0, "prompt_template": "Evaluate {resume_text} for {job_name}"}],
            "skills": [],
            "tag_ids": [],
        },
        headers=employee_headers,
    )
    template_id = template_resp.json()["data"]["id"]

    job_resp = await client.post(
        "/api/v1/employee/jobs",
        json={"dept_id": 1, "template_id": template_id, "name": name, "description": "Test"},
        headers=employee_headers,
    )
    job_id = job_resp.json()["data"]["id"]

    publish_resp = await client.put(
        f"/api/v1/employee/jobs/{job_id}",
        json={"status": 1},
        headers=employee_headers,
    )
    assert publish_resp.status_code == 200
    return job_id


@pytest.mark.asyncio
async def test_list_applications_filters_by_job_id(
    client: AsyncClient,
    employee_headers: dict,
    user_headers: dict
):
    """Test that listing applications filters by job_id"""
    job_id = await create_published_job(client, employee_headers, "Filter Test Job")

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
    job_id = await create_published_job(client, employee_headers, "Status Test Job")

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
