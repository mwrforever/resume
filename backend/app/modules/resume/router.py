import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.exceptions import BizError
from app.modules.resume.repository import ResumeRepository
from app.modules.resume.service import ResumeService
from app.schemas.vo.response.resume_response import ApiResponse, PageData, ResumeDetail, ResumeItem

employee_router = APIRouter()
user_router = APIRouter()


def get_repo(db=Depends(get_db)) -> ResumeRepository:
    return ResumeRepository(db)


def get_resume_service(db=Depends(get_db)) -> ResumeService:
    return ResumeService(ResumeRepository(db))


def get_user_id_from_token(current_user: dict = Depends(get_current_user)) -> int:
    """从token获取用户ID"""
    return int(current_user["sub"])


@user_router.post("")
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


@user_router.get("", response_model=ApiResponse[PageData])
async def list_user_resumes(
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


@user_router.get("/{resume_id}", response_model=ApiResponse[ResumeDetail])
async def get_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """获取简历详情"""
    resume = await service.get_resume_by_id(resume_id, user_id)
    return ApiResponse(data=ResumeDetail.model_validate(resume))


@user_router.get("/{resume_id}/file")
async def get_user_resume_file(
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


@user_router.delete("/{resume_id}", response_model=ApiResponse)
async def delete_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """删除简历"""
    await service.delete_resume(resume_id, user_id)
    return ApiResponse(code=200, message="删除成功")


@employee_router.get("", response_model=ApiResponse[PageData])
async def list_resumes(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    repo: ResumeRepository = Depends(get_repo),
):
    """获取简历列表（员工端）"""
    rows, total = await repo.list_all((page - 1) * page_size, page_size)
    items = []
    for resume, user in rows:
        item = ResumeItem.model_validate(resume)
        item.user_name = user.real_name if user else None
        items.append(item)
    return ApiResponse(
        data=PageData(
            total=total,
            items=items
        )
    )


@employee_router.get("/pending", response_model=ApiResponse[PageData])
async def list_pending_resumes(
    repo: ResumeRepository = Depends(get_repo),
):
    """获取待评估简历列表（员工端）"""
    items = await repo.list_pending()
    return ApiResponse(
        data=PageData(
            total=len(items),
            items=[ResumeItem.model_validate(r) for r in items]
        )
    )


@employee_router.get("/{resume_id}/file")
async def get_employee_resume_file(
    resume_id: int,
    repo: ResumeRepository = Depends(get_repo),
):
    """获取简历原始文件流（前端负责渲染：react-pdf / docx-preview）"""
    resume = await repo.get_by_id(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

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


__all__ = ["employee_router", "user_router"]
