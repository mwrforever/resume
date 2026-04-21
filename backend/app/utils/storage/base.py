from abc import ABC, abstractmethod
from fastapi import UploadFile


class BaseStorage(ABC):
    """存储策略抽象接口"""

    @abstractmethod
    async def upload(self, file: UploadFile, relative_path: str = None) -> str:
        """上传文件，返回相对路径"""
        pass

    @abstractmethod
    async def delete(self, path: str) -> bool:
        """删除文件"""
        pass

    @abstractmethod
    def get_url(self, path: str) -> str:
        """获取文件访问URL"""
        pass

    @abstractmethod
    def get_full_path(self, path: str) -> str:
        """获取文件完整路径"""
        pass