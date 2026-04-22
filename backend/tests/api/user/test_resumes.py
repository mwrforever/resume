"""
TDD Tests for User Resumes API - RED phase (failing tests first)
"""
import pytest
from httpx import AsyncClient
from io import BytesIO


@pytest.mark.asyncio
async def test_upload_resume_stores_file_metadata(client: AsyncClient, user_headers: dict):
    """Test that uploading a resume stores file metadata"""
    # Create a fake PDF file
    file_content = b"%PDF-1.4 fake pdf content for testing"
    files = {"file": ("test_resume.pdf", BytesIO(file_content), "application/pdf")}

    response = await client.post(
        "/api/v1/user/resumes",
        files=files,
        headers=user_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert "id" in data["data"]
    assert "file_name" in data["data"]
    assert data["data"]["file_name"] == "test_resume.pdf"


@pytest.mark.asyncio
async def test_list_resumes_returns_user_only(client: AsyncClient, user_headers: dict):
    """Test that listing resumes only returns current user's resumes"""
    # Upload a resume
    file_content = b"%PDF-1.4 fake pdf content"
    files = {"file": ("my_resume.pdf", BytesIO(file_content), "application/pdf")}
    await client.post("/api/v1/user/resumes", files=files, headers=user_headers)

    # List resumes
    response = await client.get("/api/v1/user/resumes", headers=user_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 200
    assert "items" in data["data"]
    # Verify all returned resumes have expected structure
    for item in data["data"]["items"]:
        assert "id" in item
        assert "file_name" in item
        assert "status" in item


@pytest.mark.asyncio
async def test_delete_resume_removes_file(client: AsyncClient, user_headers: dict):
    """Test that deleting a resume removes it from the list"""
    # Upload a resume
    file_content = b"%PDF-1.4 fake pdf content"
    files = {"file": ("to_delete.pdf", BytesIO(file_content), "application/pdf")}
    upload_resp = await client.post("/api/v1/user/resumes", files=files, headers=user_headers)
    resume_id = upload_resp.json()["data"]["id"]

    # Verify resume exists
    list_resp = await client.get("/api/v1/user/resumes", headers=user_headers)
    resume_ids = [r["id"] for r in list_resp.json()["data"]["items"]]
    assert resume_id in resume_ids

    # Delete the resume
    delete_resp = await client.delete(f"/api/v1/user/resumes/{resume_id}", headers=user_headers)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["code"] == 200

    # Verify resume is removed
    list_resp = await client.get("/api/v1/user/resumes", headers=user_headers)
    resume_ids = [r["id"] for r in list_resp.json()["data"]["items"]]
    assert resume_id not in resume_ids
