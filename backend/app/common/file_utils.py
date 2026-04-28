from pathlib import Path

from app.common.validators import ensure_safe_relative_path


def resolve_storage_file(storage_path: str, file_path: str) -> Path:
    safe_path = ensure_safe_relative_path(file_path)
    return Path(storage_path).resolve() / safe_path
