from datetime import datetime
from typing import Any

from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.agent_user_model_runtime_config_repository import AgentUserModelRuntimeConfigRepository
from app.repositories.agent_workspace_preference_repository import AgentWorkspacePreferenceRepository
from app.schemas.agent.request import AgentRuntimeConfigUpdate
from app.schemas.agent.response import AgentUserModelRuntimeConfigItem
from app.services.llm_config_service import DEFAULT_RUNTIME_PARAMS, LlmConfigService

ENV_DEFAULT_MODEL_KEY = "__env_default__"


class AgentRuntimeConfigService:
    def __init__(
        self,
        runtime_repo: AgentUserModelRuntimeConfigRepository,
        preference_repo: AgentWorkspacePreferenceRepository,
        llm_service: LlmConfigService,
    ) -> None:
        self.runtime_repo = runtime_repo
        self.preference_repo = preference_repo
        self.llm_service = llm_service

    # 获取当前员工最近选择模型；没有偏好时返回配置文件默认模型的合成运行参数
    async def get_recent_or_default(self, current_user: dict) -> AgentUserModelRuntimeConfigItem:
        employee_id = self._employee_id(current_user)
        preference = await self.preference_repo.get_by_employee(employee_id)
        if not preference or preference.selected_model_source == "env":
            return self._env_default_item(employee_id)
        return await self.get_or_init_model_config(current_user, preference.selected_model_name)

    # 获取或初始化当前员工对指定已创建模型配置的个人运行参数
    async def get_or_init_model_config(self, current_user: dict, model_name: str | None) -> AgentUserModelRuntimeConfigItem:
        if not model_name:
            return self._env_default_item(self._employee_id(current_user))
        employee_id = self._employee_id(current_user)
        option = await self._resolve_created_model_option(current_user, model_name)
        existing = await self.runtime_repo.get_by_employee_llm_config(employee_id, option["llm_config_id"])
        if existing:
            return AgentUserModelRuntimeConfigItem.model_validate(existing)
        defaults = await self.llm_service.get_default_runtime_params(option["llm_config_id"])
        payload = {
            **defaults,
            "employee_id": employee_id,
            "llm_config_id": option["llm_config_id"],
            "model_name": model_name,
            "model_source": option["model_source"],
            "last_used_at": datetime.now(),
        }
        try:
            created = await self.runtime_repo.create(**payload)
        except IntegrityError:
            existing = await self.runtime_repo.get_by_employee_llm_config(employee_id, option["llm_config_id"])
            if not existing:
                raise ValidationError("个人模型配置初始化失败，请重试")
            return AgentUserModelRuntimeConfigItem.model_validate(existing)
        return AgentUserModelRuntimeConfigItem.model_validate(created)

    # 保存当前员工对指定已创建模型配置的个人运行参数
    async def update_model_config(
        self,
        current_user: dict,
        model_name: str | None,
        body: AgentRuntimeConfigUpdate,
    ) -> AgentUserModelRuntimeConfigItem:
        if not model_name:
            raise ValidationError("配置文件默认模型不支持保存个人参数")
        current = await self.get_or_init_model_config(current_user, model_name)
        updated = await self.runtime_repo.update(current.id, **body.model_dump())
        if not updated:
            raise NotFoundError("个人模型配置不存在")
        return AgentUserModelRuntimeConfigItem.model_validate(updated)

    # 刷新工作台最近选择；已创建模型同时确保个人参数存在并刷新最近使用时间
    async def select_model(self, current_user: dict, model_name: str | None) -> AgentUserModelRuntimeConfigItem:
        employee_id = self._employee_id(current_user)
        if not model_name:
            await self.preference_repo.upsert(employee_id, None, "env", None)
            return self._env_default_item(employee_id)
        item = await self.get_or_init_model_config(current_user, model_name)
        await self.preference_repo.upsert(employee_id, item.model_name, item.model_source, item.llm_config_id)
        updated = await self.runtime_repo.touch_last_used(item.id)
        if not updated:
            raise NotFoundError("个人模型配置不存在")
        return AgentUserModelRuntimeConfigItem.model_validate(updated)

    def _employee_id(self, current_user: dict) -> int:
        return int(current_user["sub"])

    def _env_default_item(self, employee_id: int) -> AgentUserModelRuntimeConfigItem:
        return AgentUserModelRuntimeConfigItem(
            employee_id=employee_id,
            model_name=ENV_DEFAULT_MODEL_KEY,
            model_source="env",
            llm_config_id=None,
            **DEFAULT_RUNTIME_PARAMS,
        )

    async def _resolve_created_model_option(self, current_user: dict, model_name: str) -> dict[str, Any]:
        options = await self.llm_service.list_model_options(current_user)
        for option in options:
            if option.model_name == model_name and option.config_id is not None and option.source != "env":
                return {"model_source": option.source, "llm_config_id": option.config_id}
        raise NotFoundError("模型不可用")
