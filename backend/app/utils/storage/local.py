import os
import uuid
from datetime import datetime
from fastapi import UploadFile
from .base import BaseStorage


class LocalStorage(BaseStorage):
    """本地存储实现"""

    def __init__(self, base_path: str = "./note"):
        self.base_path = base_path

    async def upload(self, file: UploadFile, relative_path: str = None) -> str:
        """上传到本地note目录"""
        # 生成日期路径
        date_str = datetime.now().strftime("%Y-%m-%d")

        # 生成唯一文件名
        ext = os.path.splitext(file.filename)[1] if file.filename else ""
        unique_name = f"{uuid.uuid4().hex}{ext}"

        if relative_path:
            file_path = os.path.join(self.base_path, relative_path)
        else:
            file_path = os.path.join(self.base_path, date_str, unique_name)

        # 确保目录存在
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        # 写入文件
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        # 返回相对路径
        return relative_path or f"{date_str}/{unique_name}"

    async def delete(self, path: str) -> bool:
        """删除本地文件"""
        full_path = os.path.join(self.base_path, path)
        if os.path.exists(full_path):
            os.remove(full_path)
            return True
        return False

    def get_url(self, path: str) -> str:
        """返回文件访问路径"""
        return f"/files/{path}"