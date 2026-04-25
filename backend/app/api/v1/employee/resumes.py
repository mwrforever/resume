import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.deps import get_db, get_current_user
from app.repositories.resume_repo import ResumeRepository
from app.schemas.response import ApiResponse, PageData, ResumeItem
from app.core.config import get_settings

router = APIRouter()


def get_repo(db=Depends(get_db)) -> ResumeRepository:
    return ResumeRepository(db)


@router.get("", response_model=ApiResponse[PageData])
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


@router.get("/pending", response_model=ApiResponse[PageData])
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


@router.get("/{resume_id}/file")
async def get_resume_file(
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