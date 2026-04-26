import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from app.services.resume_service import ResumeService
from app.repositories.resume_repo import ResumeRepository
from app.api.deps import get_db, get_current_user
from app.core.config import get_settings
from app.core.exceptions import BizError
from app.schemas.response import ApiResponse, ResumeItem, ResumeDetail, PageData

router = APIRouter()


def get_resume_service(db=Depends(get_db)) -> ResumeService:
    return ResumeService(ResumeRepository(db))


def get_user_id_from_token(current_user: dict = Depends(get_current_user)) -> int:
    """从token获取用户ID"""
    return int(current_user["sub"])


@router.post("")
async def upload_resume(
    file: UploadFile,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """上传附件简历"""
    try:
        resume = await service.upload_resume(user_id, file)
        return {"code": 200, "message": "上传成功", "data": {
            "id": resume.id,
            "file_name": resume.file_name,
            "file_path": resume.file_path
        }}
    except BizError as e:
        raise e
    except Exception as e:
        raise BizError(code=500, message=f"上传失败: {str(e)}")


@router.get("", response_model=ApiResponse[PageData])
async def list_resumes(
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """获取我的简历列表"""
    resumes = await service.get_user_resumes(user_id)
    return ApiResponse(
        data=PageData(
            total=len(resumes),
            items=[ResumeItem.model_validate(r) for r in resumes]
        )
    )


@router.get("/{resume_id}", response_model=ApiResponse[ResumeDetail])
async def get_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """获取简历详情"""
    resume = await service.get_resume_by_id(resume_id, user_id)
    return ApiResponse(data=ResumeDetail.model_validate(resume))


@router.get("/{resume_id}/file")
async def get_resume_file(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    resume = await service.get_resume_by_id(resume_id, user_id)
    file_path = Path(resume.file_path)
    if not file_path.is_absolute():
        file_path = Path(get_settings().LOCAL_STORAGE_PATH) / file_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    media_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=resume.file_name,
    )


@router.delete("/{resume_id}", response_model=ApiResponse)
async def delete_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """删除简历"""
    await service.delete_resume(resume_id, user_id)
    return ApiResponse(code=200, message="删除成功")
