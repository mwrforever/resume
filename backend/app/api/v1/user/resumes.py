from fastapi import APIRouter, Depends, UploadFile, File, Query
from app.services.resume_service import ResumeService
from app.repositories.resume_repo import ResumeRepository
from app.api.deps import get_db, get_current_user
from app.core.exceptions import BizError
from app.core.security import decode_token

router = APIRouter()


def get_resume_service(db=Depends(get_db)) -> ResumeService:
    return ResumeService(ResumeRepository(db))


def get_user_id_from_token(current_user: dict = Depends(get_current_user)) -> int:
    """从token获取用户ID"""
    return int(current_user["sub"])


@router.post("")
async def upload_resume(
    file: UploadFile = File(...),
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """上传附件简历"""
    try:
        resume = await service.upload_resume(user_id, file)
        return {"code": 200, "message": "上传成功", "data": {"id": resume.id, "file_name": resume.file_name}}
    except BizError as e:
        raise e
    except Exception as e:
        raise BizError(code=500, message=f"上传失败: {str(e)}")


@router.get("")
async def list_resumes(
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """获取我的简历列表"""
    resumes = await service.get_user_resumes(user_id)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "items": [
                {
                    "id": r.id,
                    "file_name": r.file_name,
                    "status": r.status,
                    "create_time": r.create_time.isoformat() if r.create_time else None
                } for r in resumes
            ]
        }
    }


@router.get("/{resume_id}")
async def get_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """获取简历详情"""
    resume = await service.get_resume_by_id(resume_id, user_id)
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": resume.id,
            "file_name": resume.file_name,
            "file_path": resume.file_path,
            "status": resume.status,
            "create_time": resume.create_time.isoformat() if resume.create_time else None
        }
    }


@router.delete("/{resume_id}")
async def delete_resume(
    resume_id: int,
    service: ResumeService = Depends(get_resume_service),
    user_id: int = Depends(get_user_id_from_token)
):
    """删除简历"""
    await service.delete_resume(resume_id, user_id)
    return {"code": 200, "message": "删除成功", "data": None}