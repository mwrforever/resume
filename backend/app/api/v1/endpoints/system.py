import os

from fastapi import APIRouter
from fastapi.responses import FileResponse
from starlette.responses import JSONResponse

from app.utils.storage_utils import resolve_storage_file

router = APIRouter()


@router.get("/")
async def root() -> dict[str, str]:
    return {"message": "Resume Platform API"}


@router.get("/preview/{file_path:path}", response_model=None)
async def preview_resume(file_path: str, storage_path: str = ""):
    try:
        full_path = resolve_storage_file(storage_path, file_path)
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"code": 400, "message": "非法文件路径", "data": None}
        )
    if not full_path.exists():
        return JSONResponse(
            status_code=404,
            content={"code": 404, "message": "文件不存在", "data": None}
        )
    return FileResponse(full_path)
