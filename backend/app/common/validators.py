from pathlib import Path


def ensure_safe_relative_path(file_path: str) -> str:
    path = Path(file_path)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Invalid relative path")
    return file_path
