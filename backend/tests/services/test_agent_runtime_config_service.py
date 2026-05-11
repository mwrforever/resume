from datetime import datetime
from types import SimpleNamespace

import pytest

from app.core.exceptions import ValidationError
from app.schemas.agent.request import AgentRuntimeConfigUpdate
from app.services.agent_runtime_config_service import ENV_DEFAULT_MODEL_KEY, AgentRuntimeConfigService


class FakeRuntimeRepo:
    def __init__(self):
        self.items = []

    async def get_by_employee_llm_config(self, employee_id, llm_config_id):
        return next((item for item in self.items if item.employee_id == employee_id and item.llm_config_id == llm_config_id), None)

    async def create(self, **kwargs):
        if kwargs.get("llm_config_id") is None:
            raise AssertionError("llm_config_id must not be None for personal runtime config")
        item = SimpleNamespace(id=len(self.items) + 1, create_time=None, update_time=None, **kwargs)
        self.items.append(item)
        return item

    async def update(self, config_id, **kwargs):
        item = next(item for item in self.items if item.id == config_id)
        for key, value in kwargs.items():
            setattr(item, key, value)
        return item

    async def touch_last_used(self, config_id):
        item = next(item for item in self.items if item.id == config_id)
        item.last_used_at = datetime.now()
        return item


class FakePreferenceRepo:
    def __init__(self):
        self.item = None

    async def get_by_employee(self, employee_id):
        return self.item if self.item and self.item.employee_id == employee_id else None

    async def upsert(self, employee_id, selected_model_name, selected_model_source, selected_llm_config_id):
        kwargs = {
            "selected_model_name": selected_model_name,
            "selected_model_source": selected_model_source,
            "selected_llm_config_id": selected_llm_config_id,
            "last_selected_at": datetime.now(),
        }
        if self.item is None:
            self.item = SimpleNamespace(id=1, employee_id=employee_id, create_time=None, update_time=None, **kwargs)
            return self.item
        for key, value in kwargs.items():
            setattr(self.item, key, value)
        return self.item


class FakeLlmService:
    async def list_model_options(self, current_user):
        return [
            SimpleNamespace(model_name="qwen-plus", source="employee", config_id=7, biz_type="employee", biz_id=1, config_name="个人模型", base_url="https://example.test"),
            SimpleNamespace(model_name="qwen-dept", source="dept", config_id=8, biz_type="dept", biz_id=2, config_name="部门模型", base_url="https://example.test"),
        ]

    async def get_runtime_config(self, current_user, model_name):
        return SimpleNamespace(model_name=model_name or "qwen-default", source="env", extra_body={"enable_thinking": False})

    async def get_default_runtime_params(self, config_id):
        return {
            "enable_thinking": True,
            "enable_tools": True,
            "enable_prompt_cache": False,
            "enable_memory": True,
            "temperature": 0.6,
            "top_p": 0.8,
            "max_tokens": 1024,
            "presence_penalty": 0,
            "frequency_penalty": 0,
            "extra_body": {"seed": 1},
        }


def current_user():
    return {"user_type": "employee", "sub": "1"}


@pytest.mark.asyncio
async def test_get_or_init_copies_model_default_params_with_non_null_llm_config_id():
    service = AgentRuntimeConfigService(FakeRuntimeRepo(), FakePreferenceRepo(), FakeLlmService())
    item = await service.get_or_init_model_config(current_user(), "qwen-plus")
    assert item.employee_id == 1
    assert item.model_name == "qwen-plus"
    assert item.model_source == "employee"
    assert item.llm_config_id == 7
    assert item.enable_thinking is True
    assert item.temperature == 0.6
    assert item.extra_body == {"seed": 1}


@pytest.mark.asyncio
async def test_update_model_config_rejects_env_default_persistence():
    service = AgentRuntimeConfigService(FakeRuntimeRepo(), FakePreferenceRepo(), FakeLlmService())
    body = AgentRuntimeConfigUpdate(
        enable_thinking=False,
        enable_tools=False,
        enable_prompt_cache=True,
        enable_memory=False,
        temperature=0.2,
        top_p=0.7,
        max_tokens=512,
        presence_penalty=0.1,
        frequency_penalty=0.2,
        extra_body={"x": 1},
    )
    with pytest.raises(ValidationError):
        await service.update_model_config(current_user(), None, body)


@pytest.mark.asyncio
async def test_select_env_default_updates_workspace_preference_without_personal_config():
    runtime_repo = FakeRuntimeRepo()
    preference_repo = FakePreferenceRepo()
    service = AgentRuntimeConfigService(runtime_repo, preference_repo, FakeLlmService())
    item = await service.select_model(current_user(), None)
    assert item.model_name == ENV_DEFAULT_MODEL_KEY
    assert item.model_source == "env"
    assert item.llm_config_id is None
    assert runtime_repo.items == []
    assert preference_repo.item.selected_model_source == "env"
