from datetime import datetime

from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.models.llm_model_config import LlmModelConfig
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.llm_config_repository import LlmConfigRepository
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import LlmConfigCreate, LlmConfigUpdate
from app.schemas.agent.response import LlmConfigItem, LlmModelOption
from app.services.cache_service import CacheService
from app.utils.auth import is_employee_admin
from app.utils.cache_utils import LLM_MODEL_OPTIONS_TTL
from app.utils.secret_crypto import decrypt_secret, encrypt_secret, mask_secret


# 全局模型选项缓存 key（模型配置已统一为全局，不再按员工区分）
LLM_MODEL_OPTIONS_GLOBAL_KEY = "llm:model_options:global"


DEFAULT_RUNTIME_PARAMS = {
    "enable_thinking": False,
    "enable_tools": True,
    "enable_prompt_cache": False,
    "enable_memory": True,
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 2048,
    "presence_penalty": 0,
    "frequency_penalty": 0,
    "extra_body": None,
}


# 负责全局模型配置的查询、增删改权限校验（管理员限定）和运行时配置构建
class LlmConfigService:
    def __init__(
        self,
        llm_repo: LlmConfigRepository,
        employee_repo: EmployeeRepository,
        cache: CacheService | None = None,
        model_router: LLMModelRouter | None = None,
    ):
        self.llm_repo = llm_repo
        self.employee_repo = employee_repo
        self.cache = cache
        self.model_router = model_router or get_default_model_router()

    # 查询全局模型配置列表；can_manage 标记当前用户是否为管理员
    async def list_configs(
        self,
        current_user: dict,
        page: int = 1,
        page_size: int = 20,
        keyword: str | None = None,
        status: int | None = None,
    ) -> dict:
        # 仅员工账号可访问；管理员才能管理（前端按 can_manage 控制按钮）
        self._ensure_employee(current_user)
        is_admin = await self._current_is_admin(current_user)
        total = await self.llm_repo.count_all(keyword, status)
        configs = await self.llm_repo.list_all(page, page_size, keyword, status)
        items = []
        for config in configs:
            item = LlmConfigItem.model_validate(config)
            item.can_manage = is_admin
            items.append(item)
        return {"total": total, "items": items}

    # 构建当前员工可选择的模型列表，包含配置文件默认模型兜底项
    async def list_model_options(self, current_user: dict) -> list[LlmModelOption]:
        self._ensure_employee(current_user)
        if self.cache:
            cached = await self.cache.get_json(LLM_MODEL_OPTIONS_GLOBAL_KEY)
            if cached is not None:
                return self._ensure_env_model_option([LlmModelOption(**item) for item in cached])
        options = await self._build_model_options()
        if self.cache:
            await self.cache.set_json(
                LLM_MODEL_OPTIONS_GLOBAL_KEY,
                [item.model_dump() for item in options],
                LLM_MODEL_OPTIONS_TTL,
            )
        return options

    # 创建模型配置；仅管理员，model_name 全局唯一（软删未占用）
    async def create_config(self, body: LlmConfigCreate, current_user: dict) -> LlmConfigItem:
        await self._ensure_admin(current_user)
        existing = await self.llm_repo.get_by_model_name(body.model_name)
        if existing:
            raise ValidationError("该模型名已存在")
        payload = {
            "biz_type": "global",
            "biz_id": 0,
            "config_name": body.config_name,
            "protocol": body.protocol,
            "base_url": body.base_url,
            "api_key_ciphertext": encrypt_secret(body.api_key),
            "api_key_mask": mask_secret(body.api_key),
            "model_name": body.model_name,
            "fallback_model_name": body.fallback_model_name,
            "extra_body": body.extra_body,
            "enable_thinking": body.enable_thinking,
            "enable_tools": body.enable_tools,
            "enable_prompt_cache": body.enable_prompt_cache,
            "enable_memory": body.enable_memory,
            "temperature": body.temperature,
            "top_p": body.top_p,
            "max_tokens": body.max_tokens,
            "presence_penalty": body.presence_penalty,
            "frequency_penalty": body.frequency_penalty,
            "timeout_seconds": body.timeout_seconds,
            "max_retries": body.max_retries,
            "status": body.status,
        }
        try:
            config = await self.llm_repo.create(**payload)
        except IntegrityError:
            raise ValidationError("该模型名已存在")
        if not config:
            raise NotFoundError("模型配置不存在")
        await self._clear_model_options_cache()
        item = LlmConfigItem.model_validate(config)
        item.can_manage = True
        return item

    # 更新模型配置，仅管理员
    async def update_config(self, config_id: int, body: LlmConfigUpdate, current_user: dict) -> LlmConfigItem:
        await self._ensure_admin(current_user)
        config = await self.llm_repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("模型配置不存在")
        payload = body.model_dump(exclude_unset=True)
        api_key = payload.pop("api_key", None)
        if api_key:
            payload["api_key_ciphertext"] = encrypt_secret(api_key)
            payload["api_key_mask"] = mask_secret(api_key)
        model_name = payload.get("model_name")
        if model_name and model_name != config.model_name:
            existing = await self.llm_repo.get_by_model_name(model_name)
            if existing and existing.id != config.id:
                raise ValidationError("该模型名已存在")
        try:
            updated = await self.llm_repo.update(config_id, **payload)
        except IntegrityError:
            raise ValidationError("该模型名已存在")
        if not updated:
            raise NotFoundError("模型配置不存在")
        await self._clear_model_options_cache()
        item = LlmConfigItem.model_validate(updated)
        item.can_manage = True
        return item

    # 软删除模型配置，仅管理员
    async def delete_config(self, config_id: int, current_user: dict) -> None:
        await self._ensure_admin(current_user)
        config = await self.llm_repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("模型配置不存在")
        try:
            await self.llm_repo.soft_delete(config_id)
        except IntegrityError:
            raise ValidationError("模型配置删除冲突，请重试")
        await self._clear_model_options_cache()

    # 测试模型配置连通性，仅管理员；并记录最近测试结果
    async def test_config(self, config_id: int, current_user: dict) -> LlmConfigItem:
        await self._ensure_admin(current_user)
        config = await self.llm_repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("模型配置不存在")
        runtime_config = self._to_runtime_config(config)
        try:
            result = await self.model_router.complete("请回复：连接测试成功", runtime_config)
        except RuntimeError as exc:
            updated = await self.llm_repo.update(
                config_id,
                last_test_at=datetime.now(),
                last_test_status=0,
                last_test_message=str(exc)[:500],
            )
            if not updated:
                raise NotFoundError("模型配置不存在")
            item = LlmConfigItem.model_validate(updated)
            item.can_manage = True
            return item
        updated = await self.llm_repo.update(
            config_id,
            last_test_at=datetime.now(),
            last_test_status=1,
            last_test_message=result.content[:500],
        )
        if not updated:
            raise NotFoundError("模型配置不存在")
        item = LlmConfigItem.model_validate(updated)
        item.can_manage = True
        return item

    # 按模型名称解析运行时配置，未指定时使用配置文件默认模型
    async def get_runtime_config(self, current_user: dict, model_name: str | None) -> LLMRuntimeConfigDTO:
        self._ensure_employee(current_user)
        options = await self._build_model_options()
        if not model_name:
            return self._env_runtime_config()
        for option in options:
            if option.model_name == model_name:
                if option.config_id is None:
                    return self._env_runtime_config()
                config = await self.llm_repo.get_by_id(option.config_id)
                if not config or config.status != 1:
                    raise NotFoundError("模型配置不存在")
                return self._to_runtime_config(config)
        raise NotFoundError("模型不可用")

    # 获取模型创建时保存的默认运行参数，用于初始化员工个人模型配置
    async def get_default_runtime_params(self, config_id: int) -> dict:
        config = await self.llm_repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("模型配置不存在")
        return {
            "enable_thinking": bool(config.enable_thinking),
            "enable_tools": bool(config.enable_tools),
            "enable_prompt_cache": bool(config.enable_prompt_cache),
            "enable_memory": bool(config.enable_memory),
            "temperature": float(config.temperature),
            "top_p": float(config.top_p),
            "max_tokens": int(config.max_tokens),
            "presence_penalty": float(config.presence_penalty),
            "frequency_penalty": float(config.frequency_penalty),
            "extra_body": config.extra_body,
        }

    # 汇总全部启用中的全局模型配置作为前端可选模型
    async def _build_model_options(self) -> list[LlmModelOption]:
        configs = await self.llm_repo.list_available()
        options: list[LlmModelOption] = []
        seen: set[str] = set()
        for config in configs:
            if config.model_name in seen:
                continue
            seen.add(config.model_name)
            options.append(
                LlmModelOption(
                    model_name=config.model_name,
                    source="global",
                    config_id=config.id,
                    biz_type=config.biz_type,
                    biz_id=config.biz_id,
                    config_name=config.config_name,
                    base_url=config.base_url,
                )
            )
        return self._ensure_env_model_option(options)

    # 确保模型选项始终包含配置文件默认模型兜底项
    def _ensure_env_model_option(self, options: list[LlmModelOption]) -> list[LlmModelOption]:
        if any(option.source == "env" for option in options):
            return options
        return [*options, self._env_model_option()]

    # 将配置文件中的默认模型转换为前端可选择的模型项
    def _env_model_option(self) -> LlmModelOption:
        return LlmModelOption(
            model_name=settings.OPENAI_MODEL,
            source="env",
            config_id=None,
            biz_type=None,
            biz_id=None,
            config_name="系统默认模型",
            base_url=settings.OPENAI_API_BASE,
        )

    # 校验调用方是员工账号
    def _ensure_employee(self, current_user: dict) -> int:
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])

    # 校验调用方是员工管理员（增删改/测试连通性的权限边界）
    async def _ensure_admin(self, current_user: dict) -> None:
        employee_id = self._ensure_employee(current_user)
        employee = await self.employee_repo.get_by_id(employee_id)
        if not employee or not is_employee_admin(employee):
            raise ForbiddenError("仅管理员可操作模型配置")

    # 判定当前用户是否为管理员（用于在列表项上回填 can_manage 标记）
    async def _current_is_admin(self, current_user: dict) -> bool:
        if current_user.get("user_type") != "employee":
            return False
        employee = await self.employee_repo.get_by_id(int(current_user["sub"]))
        return is_employee_admin(employee)

    # 模型配置任意变更后清理全局模型选项缓存
    async def _clear_model_options_cache(self) -> None:
        if not self.cache:
            return
        await self.cache.delete(LLM_MODEL_OPTIONS_GLOBAL_KEY)
        # 迁移期一并清理历史按员工分片的缓存键
        await self.cache.delete_pattern("llm:model_options:employee:*")

    # 将数据库模型配置转换为实际调用模型所需的运行时配置
    def _to_runtime_config(self, config: LlmModelConfig) -> LLMRuntimeConfigDTO:
        from pydantic import SecretStr
        # 从 base_url 推断 provider
        provider = self._infer_provider(config.base_url)
        return LLMRuntimeConfigDTO(
            model_name=config.model_name,
            api_key=SecretStr(decrypt_secret(config.api_key_ciphertext)),
            base_url=config.base_url,
            provider=provider,
            fallback_model_name=config.fallback_model_name,
            timeout_seconds=config.timeout_seconds,
            max_retries=config.max_retries,
            enable_thinking=bool(config.enable_thinking),
            temperature=float(config.temperature),
            max_tokens=int(config.max_tokens),
        )

    # 构建配置文件默认模型的运行时配置
    def _env_runtime_config(self) -> LLMRuntimeConfigDTO:
        from pydantic import SecretStr
        provider = self._infer_provider(settings.OPENAI_API_BASE)
        return LLMRuntimeConfigDTO(
            model_name=settings.OPENAI_MODEL,
            api_key=SecretStr(settings.openai_api_key),
            base_url=settings.OPENAI_API_BASE,
            provider=provider,
            fallback_model_name=settings.FALLBACK_MODEL,
        )

    @staticmethod
    def _infer_provider(base_url: str) -> str:
        """从 base_url 推断 LLM provider。"""
        url_lower = base_url.lower()
        if "deepseek" in url_lower:
            return "deepseek"
        elif "qwen" in url_lower or "dashscope" in url_lower:
            return "qwen"
        return "other"
