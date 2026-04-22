import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.api.deps import get_db, get_current_user
from app.repositories.resume_repo import ResumeRepository
from app.utils.storage.file_parser import get_file_type, extract_text_from_docx
from app.core.config import settings

router = APIRouter()


def get_repo(db=Depends(get_db)) -> ResumeRepository:
    return ResumeRepository(db)


@router.get("/{resume_id}/file")
async def get_resume_file(
    resume_id: int,
    repo: ResumeRepository = Depends(get_repo),
    current_user: dict = Depends(get_current_user)
):
    """获取简历文件（PDF/图片直接返回，Word 提取文本返回）"""
    resume = await repo.get_by_id(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="简历不存在")

    file_type = get_file_type(resume.file_path)

    if file_type == 'docx':
        try:
            text = extract_text_from_docx(resume.file_path)
            return {"file_type": "docx", "content": text, "file_name": resume.file_name}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"解析文档失败: {str(e)}")
    elif file_type in ['pdf', 'image']:
        file_path = Path(resume.file_path)
        if not file_path.is_absolute():
            file_path = Path(settings.LOCAL_STORAGE_PATH) / file_path

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="文件不存在")

        return FileResponse(
            path=str(file_path),
            media_type=mimetypes.guess_type(str(file_path))[0],
            filename=resume.file_name
        )
    else:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_type}")