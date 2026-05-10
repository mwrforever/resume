from datetime import datetime

from app.core.config import settings
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.models.llm_model_config import LlmModelConfig
from app.repositories.dept_repository import DeptRepository
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.llm_config_repository import LlmConfigRepository
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import LlmConfigCreate, LlmConfigUpdate
from app.schemas.agent.response import LlmConfigItem, LlmModelOption
from app.services.cache_service import CacheService
from app.utils.auth import ADMIN_EMAIL
from app.utils.cache_utils import LLM_MODEL_OPTIONS_KEY, LLM_MODEL_OPTIONS_TTL
from app.utils.secret_crypto import decrypt_secret, encrypt_secret, mask_secret


class LlmConfigService:
    def __init__(
        self,
        llm_repo: LlmConfigRepository,
        employee_repo: EmployeeRepository,
        dept_repo: DeptRepository,
        cache: CacheService | None = None,
        model_router: LLMModelRouter | None = None,
    ):
        self.llm_repo = llm_repo
        self.employee_repo = employee_repo
        self.dept_repo = dept_repo
        self.cache = cache
        self.model_router = model_router or get_default_model_router()

    async def list_configs(self, current_user: dict) -> list[LlmConfigItem]:
        employee_id = self._current_employee_id(current_user)
        dept_ids = await self._employee_dept_ids(employee_id)
        configs = []
        configs.extend(await self.llm_repo.list_by_biz("employee", employee_id))
        for dept_id in dept_ids:
            configs.extend(await self.llm_repo.list_by_biz("dept", dept_id))
        return [LlmConfigItem.model_validate(config) for config in configs]

    async def list_model_options(self, current_user: dict) -> list[LlmModelOption]:
        employee_id = self._current_employee_id(current_user)
        cache_key = LLM_MODEL_OPTIONS_KEY.format(employee_id=employee_id)
        if self.cache:
            cached = await self.cache.get_json(cache_key)
            if cached is not None:
                return [LlmModelOption(**item) for item in cached]
        options = await self._build_model_options(employee_id)
        if self.cache:
            await self.cache.set_json(cache_key, [item.model_dump() for item in options], LLM_MODEL_OPTIONS_TTL)
        return options

    async def create_config(self, body: LlmConfigCreate, current_user: dict) -> LlmConfigItem:
        await self._ensure_can_manage(body.biz_type, body.biz_id, current_user)
        existing = await self.llm_repo.get_by_biz_model(body.biz_type, body.biz_id, body.model_name)
        if existing:
            raise ValidationError("该业务主体下模型配置已存在")
        config = await self.llm_repo.create(
            biz_type=body.biz_type,
            biz_id=body.biz_id,
            config_name=body.config_name,
            protocol=body.protocol,
            base_url=body.base_url,
            api_key_ciphertext=encrypt_secret(body.api_key),
            api_key_mask=mask_secret(body.api_key),
            model_name=body.model_name,
            fallback_model_name=body.fallback_model_name,
            extra_body=body.extra_body,
            timeout_seconds=body.timeout_seconds,
            max_retries=body.max_retries,
            status=body.status,
        )
        await self._clear_related_model_options(config)
        return LlmConfigItem.model_validate(config)

    async def update_config(self, config_id: int, body: LlmConfigUpdate, current_user: dict) -> LlmConfigItem:
        config = await self._get_manageable_config(config_id, current_user)
        payload = body.model_dump(exclude_unset=True)
        api_key = payload.pop("api_key", None)
        if api_key:
            payload["api_key_ciphertext"] = encrypt_secret(api_key)
            payload["api_key_mask"] = mask_secret(api_key)
        model_name = payload.get("model_name")
        if model_name and model_name != config.model_name:
            existing = await self.llm_repo.get_by_biz_model(config.biz_type, config.biz_id, model_name)
            if existing and existing.id != config.id:
                raise ValidationError("该业务主体下模型配置已存在")
        updated = await self.llm_repo.update(config_id, **payload)
        if not updated:
            raise NotFoundError("模型配置不存在")
        await self._clear_related_model_options(updated)
        return LlmConfigItem.model_validate(updated)

    async def delete_config(self, config_id: int, current_user: dict) -> None:
        config = await self._get_manageable_config(config_id, current_user)
        await self.llm_repo.delete(config_id)
        await self._clear_related_model_options(config)

    async def test_config(self, config_id: int, current_user: dict) -> LlmConfigItem:
        config = await self._get_manageable_config(config_id, current_user)
        runtime_config = self._to_runtime_config(config, self._source_for_config(config))
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
            return LlmConfigItem.model_validate(updated)
        updated = await self.llm_repo.update(
            config_id,
            last_test_at=datetime.now(),
            last_test_status=1,
            last_test_message=result.content[:500],
        )
        if not updated:
            raise NotFoundError("模型配置不存在")
        return LlmConfigItem.model_validate(updated)

    async def get_runtime_config(self, current_user: dict, model_name: str | None) -> LLMRuntimeConfigDTO:
        employee_id = self._current_employee_id(current_user)
        options = await self._build_model_options(employee_id)
        if not model_name:
            return self._env_runtime_config()
        for option in options:
            if option.model_name == model_name:
                if option.config_id is None:
                    return self._env_runtime_config()
                config = await self.llm_repo.get_by_id(option.config_id)
                if not config or config.status != 1:
                    raise NotFoundError("模型配置不存在")
                return self._to_runtime_config(config, option.source)
        raise NotFoundError("模型不可用")

    async def _build_model_options(self, employee_id: int) -> list[LlmModelOption]:
        dept_ids = await self._employee_dept_ids(employee_id)
        configs = await self.llm_repo.list_employee_available(employee_id, dept_ids)
        option_map: dict[str, LlmModelOption] = {}
        for config in configs:
            option = LlmModelOption(
                model_name=config.model_name,
                source=self._source_for_config(config),
                config_id=config.id,
                biz_type=config.biz_type,
                biz_id=config.biz_id,
                config_name=config.config_name,
                base_url=config.base_url,
            )
            current = option_map.get(config.model_name)
            if not current or self._source_priority(option.source) > self._source_priority(current.source):
                option_map[config.model_name] = option
        if settings.OPENAI_MODEL not in option_map:
            option_map[settings.OPENAI_MODEL] = LlmModelOption(
                model_name=settings.OPENAI_MODEL,
                source="env",
                config_id=None,
                biz_type=None,
                biz_id=None,
                config_name="系统默认模型",
                base_url=settings.OPENAI_API_BASE,
            )
        return list(option_map.values())

    async def _get_manageable_config(self, config_id: int, current_user: dict) -> LlmModelConfig:
        config = await self.llm_repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("模型配置不存在")
        await self._ensure_can_manage(config.biz_type, config.biz_id, current_user)
        return config

    async def _ensure_can_manage(self, biz_type: str, biz_id: int, current_user: dict) -> None:
        employee_id = self._current_employee_id(current_user)
        if biz_type == "employee":
            employee = await self.employee_repo.get_by_id(biz_id)
            if not employee:
                raise ValidationError("员工不存在")
            if biz_id != employee_id:
                raise ForbiddenError("只能维护自己的模型配置")
            return
        if biz_type == "dept":
            dept = await self.dept_repo.get_by_id(biz_id)
            if not dept:
                raise ValidationError("部门不存在")
            employee = await self.employee_repo.get_by_id(employee_id)
            if employee and (employee.email == ADMIN_EMAIL or dept.leader_id == employee_id):
                return
            raise ForbiddenError("当前员工无部门模型配置权限")
        raise ValidationError("不支持的业务类型")

    async def _employee_dept_ids(self, employee_id: int) -> list[int]:
        return [int(item["dept_id"]) for item in await self.employee_repo.list_employee_depts(employee_id)]

    async def _clear_related_model_options(self, config: LlmModelConfig) -> None:
        if not self.cache:
            return
        if config.biz_type == "employee":
            await self.cache.delete(LLM_MODEL_OPTIONS_KEY.format(employee_id=config.biz_id))
            return
        await self.cache.delete_pattern("llm:model_options:employee:*")

    def _current_employee_id(self, current_user: dict) -> int:
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])

    def _source_for_config(self, config: LlmModelConfig) -> str:
        return "employee" if config.biz_type == "employee" else "dept"

    def _source_priority(self, source: str) -> int:
        return {"employee": 3, "dept": 2, "env": 1}.get(source, 0)

    def _to_runtime_config(self, config: LlmModelConfig, source: str) -> LLMRuntimeConfigDTO:
        return LLMRuntimeConfigDTO(
            model_name=config.model_name,
            api_key=decrypt_secret(config.api_key_ciphertext),
            base_url=config.base_url,
            fallback_model_name=config.fallback_model_name,
            extra_body=config.extra_body,
            timeout_seconds=config.timeout_seconds,
            max_retries=config.max_retries,
            source=source,
        )

    def _env_runtime_config(self) -> LLMRuntimeConfigDTO:
        return LLMRuntimeConfigDTO(
            model_name=settings.OPENAI_MODEL,
            api_key=settings.openai_api_key,
            base_url=settings.OPENAI_API_BASE,
            fallback_model_name=settings.FALLBACK_MODEL,
            extra_body={"enable_thinking": False},
            source="env",
        )
