import os
from pathlib import Path

from app.core.config import get_settings


def resolve_storage_file(storage_path: str, file_path: str) -> Path:
    """解析存储文件路径，防止路径遍历攻击"""
    settings = get_settings()
    base = Path(storage_path) if storage_path else Path(settings.LOCAL_STORAGE_PATH)

    # 清理file_path中的危险字符
    safe_name = os.path.basename(file_path)
    if not safe_name or safe_name in (".", ".."):
        raise ValueError("非法文件路径")

    full_path = (base / safe_name).resolve()

    # 防止路径穿越
    try:
        full_path.relative_to(base.resolve())
    except ValueError:
        raise ValueError("非法文件路径")

    return full_path