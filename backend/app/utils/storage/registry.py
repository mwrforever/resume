from typing import Dict, Type
from .base import BaseStorage
from .local import LocalStorage


class StorageRegistry:
    """存储策略注册器"""
    _strategies: Dict[str, Type[BaseStorage]] = {}

    @classmethod
    def register(cls, name: str, strategy: Type[BaseStorage]):
        """注册存储策略"""
        cls._strategies[name] = strategy

    @classmethod
    def get(cls, name: str = None) -> BaseStorage:
        """获取存储策略实例"""
        from app.core.config import get_settings
        settings = get_settings()
        storage_type = name or settings.STORAGE_TYPE
        strategy_class = cls._strategies.get(storage_type, LocalStorage)
        return strategy_class()

    @classmethod
    def setup(cls):
        """初始化注册默认策略"""
        cls.register("LOCAL", LocalStorage)
        # Future: cls.register("OSS", OssStorage)
        # Future: cls.register("COS", CosStorage)


# 初始化
StorageRegistry.setup()