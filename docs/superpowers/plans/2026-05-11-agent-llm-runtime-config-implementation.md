# Agent LLM Runtime Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Agent workspace and LLM runtime configuration redesign, including model-default runtime parameters, user-personal model runtime parameters, explicit prompt-cache control, paginated LLM config loading, and the redesigned Agent/LLM frontend experience.

**Architecture:** Update database DDL first, then align ORM models, schemas, repositories, services, endpoints, and frontend clients. Runtime parameters are owned by model defaults and by employee+model personal configs, not by sessions; sessions only retain selected model identity, while each run stores the effective runtime snapshot in `agent_run.input_payload` for trace replay.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy 2.x Async ORM, MySQL DDL in `sql/init.sql`, React 19, TypeScript, Vite, Tailwind CSS, Axios, Zustand, Lucide React, `react-markdown`.

---

## Scope and ordering constraints

- The user explicitly required: **update `sql/init.sql` DDL before implementing related backend/frontend code**.
- Keep the existing endpoint/service/repository layering: `endpoint -> service -> repository -> db/redis -> schema`.
- Do not move runtime generation parameters back into `llm_model_config.extra_body`; `extra_body` remains advanced provider-specific JSON.
- Preserve existing model connection permissions, soft delete, API key encryption, Agent SSE behavior, action confirmation behavior, and existing auth.
- Use the updated design spec: `docs/superpowers/specs/2026-05-11-agent-llm-ui-runtime-config-design.md`.

---

## File structure and responsibilities

### SQL / backend persistence

- Modify: `sql/init.sql`
  - Add default runtime parameter columns to `llm_model_config`.
  - Add new `agent_user_model_runtime_config` table.
  - Keep comments in readable Chinese and UTF-8.
- Modify: `backend/app/models/llm_model_config.py`
  - Add ORM fields matching `llm_model_config` DDL.
- Create: `backend/app/models/agent_user_model_runtime_config.py`
  - ORM model for employee+model personal runtime config.
- Modify: `backend/app/models/__init__.py`
  - Export the new ORM model.
- Create: `backend/app/repositories/agent_user_model_runtime_config_repository.py`
  - Data access only: get, get recent, create/update, touch last used.
- Modify: `backend/app/repositories/llm_config_repository.py`
  - Add count/list pagination helpers and default runtime param persistence.
- Modify: `backend/app/repositories/agent_repository.py`
  - Keep session model selection updates focused on selected model identity.

### Backend schemas / services / API

- Modify: `backend/app/schemas/agent/request.py`
  - Add reusable runtime config request schema and extend LLM create/update schemas.
- Modify: `backend/app/schemas/agent/response.py`
  - Add runtime config response schema and extend LLM config response.
- Modify: `backend/app/schemas/agent/dto.py`
  - Extend `LLMRuntimeConfigDTO` to carry effective runtime flags/parameters.
- Create: `backend/app/services/agent_runtime_config_service.py`
  - Business owner for model defaults, employee+model personal config initialization, updates, recent model selection, and effective runtime config composition.
- Modify: `backend/app/services/llm_config_service.py`
  - Support paginated config listing and model default runtime params on create/update/response.
- Modify: `backend/app/services/agent_service.py`
  - Resolve effective user+model runtime config before graph execution, respect memory/tools/prompt-cache switches, and write runtime snapshot to run input payload.
- Modify: `backend/app/api/v1/endpoints/agent.py`
  - Wire `AgentRuntimeConfigService` dependency and add runtime config endpoints.
  - Change LLM config list endpoint to `PageData`.

### Backend LLM runtime / tools

- Modify: `backend/app/llm/graphs/agent_runtime_graph.py`
  - Ensure disabled tools skip tool planning/execution.
- Modify as needed: `backend/app/llm/model_router.py`, `backend/app/llm/gateway.py`
  - Pass merged `extra_body` / generation args through consistently.

### Frontend

- Modify: `frontend/src/types/agent.ts`
  - Add runtime config types, paginated LLM config query/response types, and default runtime fields on config payload/item.
- Modify: `frontend/src/api/employee/agent.ts`
  - Add paginated config params and runtime config API methods.
- Modify: `frontend/src/pages/employee/llm-configs.tsx`
  - Backend pagination + infinite scroll + throttled refresh/search/filter.
  - Model default runtime parameter controls in create/edit dialog.
- Modify: `frontend/src/pages/employee/agent.tsx`
  - ChatGPT-like layout refinements, collapsible left session sidebar, right runtime config/trace panel, markdown rendering, inline tool timeline, and personal model config persistence.
- Create as needed: `frontend/src/components/employee/agent/*`
  - Focused Agent layout, message, tool timeline, config panel components.
- Create as needed: `frontend/src/components/employee/llm-configs/*`
  - Runtime parameter controls if `llm-configs.tsx` becomes too large.

### Tests / validation

- Create: `backend/tests/services/test_agent_runtime_config_service.py`
- Create: `backend/tests/services/test_llm_config_pagination.py`
- Create or modify frontend tests if current setup supports component tests; otherwise verify with TypeScript and production build.

---

## Task 1: DDL first - update `sql/init.sql`

**Files:**
- Modify: `sql/init.sql`

- [ ] **Step 1: Add default runtime parameter columns to `llm_model_config` DDL**

In `sql/init.sql`, inside the existing `CREATE TABLE IF NOT EXISTS llm_model_config` block, add these columns after `extra_body` and before `timeout_seconds`:

```sql
    `enable_thinking`       TINYINT(1)             NOT NULL DEFAULT 0 COMMENT '是否开启思考模式',
    `enable_tools`          TINYINT(1)             NOT NULL DEFAULT 1 COMMENT '是否启用工具调用',
    `enable_prompt_cache`   TINYINT(1)             NOT NULL DEFAULT 0 COMMENT '是否启用LLM前缀缓存',
    `enable_memory`         TINYINT(1)             NOT NULL DEFAULT 1 COMMENT '是否启用上下文记忆',
    `temperature`           DECIMAL(4, 2)          NOT NULL DEFAULT 0.70 COMMENT '生成随机性',
    `top_p`                 DECIMAL(4, 2)          NOT NULL DEFAULT 0.90 COMMENT '核采样参数',
    `max_tokens`            INT                    NOT NULL DEFAULT 2048 COMMENT '最大输出Token',
    `presence_penalty`      DECIMAL(4, 2)          NOT NULL DEFAULT 0.00 COMMENT '话题出现惩罚',
    `frequency_penalty`     DECIMAL(4, 2)          NOT NULL DEFAULT 0.00 COMMENT '频率惩罚',
```

- [ ] **Step 2: Add `agent_user_model_runtime_config` table immediately after `agent_session` DDL**

Insert this table before `agent_message`:

```sql
CREATE TABLE IF NOT EXISTS `agent_user_model_runtime_config`
(
    `id`                  BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '个人模型运行配置ID',
    `employee_id`         BIGINT       NOT NULL COMMENT '员工ID',
    `model_name`          VARCHAR(100) NOT NULL COMMENT '模型名称，配置文件默认模型使用__env_default__',
    `model_source`        VARCHAR(20)  NOT NULL COMMENT '模型来源：env/employee/dept',
    `llm_config_id`       BIGINT                DEFAULT NULL COMMENT '模型连接配置ID，配置文件默认模型为空',
    `enable_thinking`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否开启思考模式',
    `enable_tools`        TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用工具调用',
    `enable_prompt_cache` TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否启用LLM前缀缓存',
    `enable_memory`       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用上下文记忆',
    `temperature`         DECIMAL(4, 2) NOT NULL DEFAULT 0.70 COMMENT '生成随机性',
    `top_p`               DECIMAL(4, 2) NOT NULL DEFAULT 0.90 COMMENT '核采样参数',
    `max_tokens`          INT          NOT NULL DEFAULT 2048 COMMENT '最大输出Token',
    `presence_penalty`    DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT '话题出现惩罚',
    `frequency_penalty`   DECIMAL(4, 2) NOT NULL DEFAULT 0.00 COMMENT '频率惩罚',
    `extra_body`          JSON                  DEFAULT NULL COMMENT '高级运行参数',
    `last_used_at`        DATETIME              DEFAULT NULL COMMENT '最近使用时间',
    `create_time`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY `uk_employee_model_source` (`employee_id`, `model_name`, `model_source`),
    KEY `idx_employee_last_used` (`employee_id`, `last_used_at`),
    KEY `idx_llm_config` (`llm_config_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='员工个人模型运行配置表';
```

- [ ] **Step 3: Verify DDL text contains expected anchors**

Run from workspace root:

```powershell
Select-String -Path sql\init.sql -Pattern "enable_prompt_cache|agent_user_model_runtime_config|uk_employee_model_source"
```

Expected: output contains all three patterns.

- [ ] **Step 4: Commit DDL first**

```powershell
git add -- sql/init.sql; git commit -m "db: add agent runtime config ddl" -- sql/init.sql
```

Expected: one commit containing only `sql/init.sql`.

---

## Task 2: Backend ORM and schemas for runtime parameters

**Files:**
- Modify: `backend/app/models/llm_model_config.py`
- Create: `backend/app/models/agent_user_model_runtime_config.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/schemas/agent/request.py`
- Modify: `backend/app/schemas/agent/response.py`
- Modify: `backend/app/schemas/agent/dto.py`

- [ ] **Step 1: Extend `LlmModelConfig` ORM fields**

Add imports in `backend/app/models/llm_model_config.py`:

```python
from decimal import Decimal
```

Update SQLAlchemy imports to include `Boolean`, `Integer`, and `Numeric`:

```python
from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, JSON, Numeric, SmallInteger, String, Text, UniqueConstraint
```

Add mapped columns after `extra_body`:

```python
    enable_thinking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否开启思考模式")
    enable_tools: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用工具调用")
    enable_prompt_cache: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否启用LLM前缀缓存")
    enable_memory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用上下文记忆")
    temperature: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.70"), comment="生成随机性")
    top_p: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.90"), comment="核采样参数")
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=2048, comment="最大输出Token")
    presence_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="话题出现惩罚")
    frequency_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="频率惩罚")
```

- [ ] **Step 2: Create `AgentUserModelRuntimeConfig` ORM model**

Create `backend/app/models/agent_user_model_runtime_config.py`:

```python
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentUserModelRuntimeConfig(Base):
    __tablename__ = "agent_user_model_runtime_config"
    __table_args__ = (
        UniqueConstraint("employee_id", "model_name", "model_source", name="uk_employee_model_source"),
        Index("idx_employee_last_used", "employee_id", "last_used_at"),
        Index("idx_llm_config", "llm_config_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="员工ID")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="模型名称，配置文件默认模型使用__env_default__")
    model_source: Mapped[str] = mapped_column(String(20), nullable=False, comment="模型来源：env/employee/dept")
    llm_config_id: Mapped[int | None] = mapped_column(BigInteger, comment="模型连接配置ID，配置文件默认模型为空")
    enable_thinking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否开启思考模式")
    enable_tools: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用工具调用")
    enable_prompt_cache: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否启用LLM前缀缓存")
    enable_memory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用上下文记忆")
    temperature: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.70"), comment="生成随机性")
    top_p: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.90"), comment="核采样参数")
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=2048, comment="最大输出Token")
    presence_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="话题出现惩罚")
    frequency_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="频率惩罚")
    extra_body: Mapped[dict[str, Any] | None] = mapped_column(JSON, comment="高级运行参数")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, comment="最近使用时间")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
```

- [ ] **Step 3: Export the new model**

In `backend/app/models/__init__.py`, add:

```python
from .agent_user_model_runtime_config import AgentUserModelRuntimeConfig
```

Append `"AgentUserModelRuntimeConfig"` to `__all__`.

- [ ] **Step 4: Add runtime request schemas**

In `backend/app/schemas/agent/request.py`, add after constants:

```python
class AgentRuntimeConfigUpdate(BaseModel):
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.9, ge=0, le=1)
    max_tokens: int = Field(default=2048, ge=1, le=32000)
    presence_penalty: float = Field(default=0, ge=-2, le=2)
    frequency_penalty: float = Field(default=0, ge=-2, le=2)
    extra_body: dict[str, Any] | None = None
```

Extend `LlmConfigCreate` with the same fields and defaults; extend `LlmConfigUpdate` with optional versions:

```python
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.9, ge=0, le=1)
    max_tokens: int = Field(default=2048, ge=1, le=32000)
    presence_penalty: float = Field(default=0, ge=-2, le=2)
    frequency_penalty: float = Field(default=0, ge=-2, le=2)
```

For `LlmConfigUpdate`, use `bool | None` and `float | None` / `int | None` with `default=None`.

- [ ] **Step 5: Add runtime response schemas**

In `backend/app/schemas/agent/response.py`, add runtime fields to `LlmConfigItem`:

```python
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    presence_penalty: float = 0
    frequency_penalty: float = 0
```

Add new response class after `LlmModelOption`:

```python
class AgentUserModelRuntimeConfigItem(BaseModel):
    id: int | None = None
    employee_id: int
    model_name: str
    model_source: str
    llm_config_id: int | None = None
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    presence_penalty: float = 0
    frequency_penalty: float = 0
    extra_body: dict[str, Any] | None = None
    last_used_at: datetime | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 6: Extend `LLMRuntimeConfigDTO`**

In `backend/app/schemas/agent/dto.py`, add fields to `LLMRuntimeConfigDTO`:

```python
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    presence_penalty: float = 0
    frequency_penalty: float = 0
```

- [ ] **Step 7: Run syntax validation**

Run from `backend`:

```powershell
python -m py_compile app\models\llm_model_config.py app\models\agent_user_model_runtime_config.py app\models\__init__.py app\schemas\agent\request.py app\schemas\agent\response.py app\schemas\agent\dto.py
```

Expected: exit code 0.

- [ ] **Step 8: Commit ORM and schema changes**

```powershell
git add -- backend/app/models/llm_model_config.py backend/app/models/agent_user_model_runtime_config.py backend/app/models/__init__.py backend/app/schemas/agent/request.py backend/app/schemas/agent/response.py backend/app/schemas/agent/dto.py; git commit -m "feat: add agent runtime config schemas"
```

---

## Task 3: Backend repositories and runtime config service

**Files:**
- Create: `backend/app/repositories/agent_user_model_runtime_config_repository.py`
- Modify: `backend/app/repositories/llm_config_repository.py`
- Create: `backend/app/services/agent_runtime_config_service.py`
- Test: `backend/tests/services/test_agent_runtime_config_service.py`

- [ ] **Step 1: Write structural/service tests first**

Create `backend/tests/services/test_agent_runtime_config_service.py`:

```python
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.schemas.agent.request import AgentRuntimeConfigUpdate
from app.services.agent_runtime_config_service import ENV_DEFAULT_MODEL_KEY, AgentRuntimeConfigService


class FakeRuntimeRepo:
    def __init__(self):
        self.items = []

    async def get_by_employee_model(self, employee_id, model_name, model_source):
        return next((item for item in self.items if item.employee_id == employee_id and item.model_name == model_name and item.model_source == model_source), None)

    async def get_recent_by_employee(self, employee_id):
        matches = [item for item in self.items if item.employee_id == employee_id]
        return sorted(matches, key=lambda item: item.last_used_at or datetime.min, reverse=True)[0] if matches else None

    async def create(self, **kwargs):
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


class FakeLlmService:
    async def list_model_options(self, current_user):
        return [SimpleNamespace(model_name="qwen-plus", source="employee", config_id=7, biz_type="employee", biz_id=1, config_name="个人模型", base_url="https://example.test")]

    async def get_runtime_config(self, current_user, model_name):
        return SimpleNamespace(model_name=model_name or "qwen-plus", source="employee", extra_body={"enable_thinking": False})

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
async def test_get_or_init_copies_model_default_params():
    service = AgentRuntimeConfigService(FakeRuntimeRepo(), FakeLlmService())
    item = await service.get_or_init_model_config(current_user(), "qwen-plus")
    assert item.employee_id == 1
    assert item.model_name == "qwen-plus"
    assert item.llm_config_id == 7
    assert item.enable_thinking is True
    assert item.temperature == 0.6
    assert item.extra_body == {"seed": 1}


@pytest.mark.asyncio
async def test_update_model_config_is_personal_to_employee_and_model():
    repo = FakeRuntimeRepo()
    service = AgentRuntimeConfigService(repo, FakeLlmService())
    await service.get_or_init_model_config(current_user(), "qwen-plus")
    body = AgentRuntimeConfigUpdate(enable_thinking=False, enable_tools=False, enable_prompt_cache=True, enable_memory=False, temperature=0.2, top_p=0.7, max_tokens=512, presence_penalty=0.1, frequency_penalty=0.2, extra_body={"x": 1})
    item = await service.update_model_config(current_user(), "qwen-plus", body)
    assert item.enable_tools is False
    assert item.enable_prompt_cache is True
    assert item.max_tokens == 512


@pytest.mark.asyncio
async def test_env_default_model_uses_stable_key():
    service = AgentRuntimeConfigService(FakeRuntimeRepo(), FakeLlmService())
    item = await service.get_or_init_model_config(current_user(), None)
    assert item.model_name == ENV_DEFAULT_MODEL_KEY
```

- [ ] **Step 2: Run tests to verify they fail before implementation**

Run from `backend`:

```powershell
python -m pytest tests\services\test_agent_runtime_config_service.py -q
```

Expected: FAIL because `app.services.agent_runtime_config_service` does not exist.

- [ ] **Step 3: Create runtime config repository**

Create `backend/app/repositories/agent_user_model_runtime_config_repository.py`:

```python
from datetime import datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_user_model_runtime_config import AgentUserModelRuntimeConfig


class AgentUserModelRuntimeConfigRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_employee_model(self, employee_id: int, model_name: str, model_source: str) -> AgentUserModelRuntimeConfig | None:
        result = await self.db.execute(
            select(AgentUserModelRuntimeConfig).where(
                AgentUserModelRuntimeConfig.employee_id == employee_id,
                AgentUserModelRuntimeConfig.model_name == model_name,
                AgentUserModelRuntimeConfig.model_source == model_source,
            )
        )
        return result.scalar_one_or_none()

    async def get_recent_by_employee(self, employee_id: int) -> AgentUserModelRuntimeConfig | None:
        result = await self.db.execute(
            select(AgentUserModelRuntimeConfig)
            .where(AgentUserModelRuntimeConfig.employee_id == employee_id)
            .order_by(AgentUserModelRuntimeConfig.last_used_at.desc(), AgentUserModelRuntimeConfig.update_time.desc(), AgentUserModelRuntimeConfig.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def create(self, **kwargs: Any) -> AgentUserModelRuntimeConfig:
        item = AgentUserModelRuntimeConfig(**kwargs)
        self.db.add(item)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise
        await self.db.refresh(item)
        return item

    async def update(self, config_id: int, **kwargs: Any) -> AgentUserModelRuntimeConfig | None:
        try:
            await self.db.execute(update(AgentUserModelRuntimeConfig).where(AgentUserModelRuntimeConfig.id == config_id).values(**kwargs))
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            raise
        result = await self.db.execute(select(AgentUserModelRuntimeConfig).where(AgentUserModelRuntimeConfig.id == config_id))
        return result.scalar_one_or_none()

    async def touch_last_used(self, config_id: int) -> AgentUserModelRuntimeConfig | None:
        return await self.update(config_id, last_used_at=datetime.now())
```

- [ ] **Step 4: Add default runtime parameter helper to LLM service**

In `backend/app/services/llm_config_service.py`, add constants near imports:

```python
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
```

Add method:

```python
    # 获取模型创建时保存的默认运行参数，用于初始化员工个人模型配置
    async def get_default_runtime_params(self, config_id: int | None) -> dict:
        if config_id is None:
            return dict(DEFAULT_RUNTIME_PARAMS)
        config = await self.llm_repo.get_by_id(config_id)
        if not config:
            return dict(DEFAULT_RUNTIME_PARAMS)
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
```

- [ ] **Step 5: Create runtime config service**

Create `backend/app/services/agent_runtime_config_service.py`:

```python
from datetime import datetime
from typing import Any

from sqlalchemy.exc import IntegrityError

from app.core.exceptions import NotFoundError, ValidationError
from app.repositories.agent_user_model_runtime_config_repository import AgentUserModelRuntimeConfigRepository
from app.schemas.agent.request import AgentRuntimeConfigUpdate
from app.schemas.agent.response import AgentUserModelRuntimeConfigItem
from app.services.llm_config_service import DEFAULT_RUNTIME_PARAMS, LlmConfigService

ENV_DEFAULT_MODEL_KEY = "__env_default__"


class AgentRuntimeConfigService:
    def __init__(self, runtime_repo: AgentUserModelRuntimeConfigRepository, llm_service: LlmConfigService) -> None:
        self.runtime_repo = runtime_repo
        self.llm_service = llm_service

    # 获取或初始化当前员工最近使用模型；没有历史记录时使用配置文件默认模型
    async def get_recent_or_default(self, current_user: dict) -> AgentUserModelRuntimeConfigItem:
        employee_id = self._employee_id(current_user)
        recent = await self.runtime_repo.get_recent_by_employee(employee_id)
        if recent:
            return AgentUserModelRuntimeConfigItem.model_validate(recent)
        return await self.get_or_init_model_config(current_user, None)

    # 获取或初始化当前员工对指定模型的个人运行配置
    async def get_or_init_model_config(self, current_user: dict, model_name: str | None) -> AgentUserModelRuntimeConfigItem:
        employee_id = self._employee_id(current_user)
        normalized_model_name = self._normalize_model_name(model_name)
        option = await self._resolve_model_option(current_user, model_name)
        existing = await self.runtime_repo.get_by_employee_model(employee_id, normalized_model_name, option["model_source"])
        if existing:
            return AgentUserModelRuntimeConfigItem.model_validate(existing)
        defaults = await self.llm_service.get_default_runtime_params(option["llm_config_id"])
        payload = {
            **defaults,
            "employee_id": employee_id,
            "model_name": normalized_model_name,
            "model_source": option["model_source"],
            "llm_config_id": option["llm_config_id"],
            "last_used_at": datetime.now(),
        }
        try:
            created = await self.runtime_repo.create(**payload)
        except IntegrityError:
            existing = await self.runtime_repo.get_by_employee_model(employee_id, normalized_model_name, option["model_source"])
            if not existing:
                raise ValidationError("个人模型配置初始化失败，请重试")
            return AgentUserModelRuntimeConfigItem.model_validate(existing)
        return AgentUserModelRuntimeConfigItem.model_validate(created)

    # 保存当前员工对指定模型的个人运行参数
    async def update_model_config(self, current_user: dict, model_name: str | None, body: AgentRuntimeConfigUpdate) -> AgentUserModelRuntimeConfigItem:
        current = await self.get_or_init_model_config(current_user, model_name)
        updated = await self.runtime_repo.update(current.id, **body.model_dump())
        if not updated:
            raise NotFoundError("个人模型配置不存在")
        return AgentUserModelRuntimeConfigItem.model_validate(updated)

    # 刷新最近使用模型，用于下次进入工作台时恢复选择
    async def select_model(self, current_user: dict, model_name: str | None) -> AgentUserModelRuntimeConfigItem:
        current = await self.get_or_init_model_config(current_user, model_name)
        updated = await self.runtime_repo.touch_last_used(current.id)
        if not updated:
            raise NotFoundError("个人模型配置不存在")
        return AgentUserModelRuntimeConfigItem.model_validate(updated)

    def _employee_id(self, current_user: dict) -> int:
        return int(current_user["sub"])

    def _normalize_model_name(self, model_name: str | None) -> str:
        return model_name or ENV_DEFAULT_MODEL_KEY

    async def _resolve_model_option(self, current_user: dict, model_name: str | None) -> dict[str, Any]:
        if not model_name:
            runtime_config = await self.llm_service.get_runtime_config(current_user, None)
            return {"model_source": runtime_config.source, "llm_config_id": None}
        options = await self.llm_service.list_model_options(current_user)
        for option in options:
            if option.model_name == model_name:
                return {"model_source": option.source, "llm_config_id": option.config_id}
        raise NotFoundError("模型不可用")
```

- [ ] **Step 6: Run focused tests**

Run from `backend`:

```powershell
python -m pytest tests\services\test_agent_runtime_config_service.py -q
```

Expected: PASS.

- [ ] **Step 7: Run syntax validation**

Run from `backend`:

```powershell
python -m py_compile app\repositories\agent_user_model_runtime_config_repository.py app\repositories\llm_config_repository.py app\services\agent_runtime_config_service.py app\services\llm_config_service.py
```

Expected: exit code 0.

- [ ] **Step 8: Commit repository/service changes**

```powershell
git add -- backend/app/repositories/agent_user_model_runtime_config_repository.py backend/app/repositories/llm_config_repository.py backend/app/services/agent_runtime_config_service.py backend/app/services/llm_config_service.py backend/tests/services/test_agent_runtime_config_service.py; git commit -m "feat: add user model runtime config service"
```

---

## Task 4: Backend LLM config pagination and model-default params

**Files:**
- Modify: `backend/app/repositories/llm_config_repository.py`
- Modify: `backend/app/services/llm_config_service.py`
- Modify: `backend/app/api/v1/endpoints/agent.py`
- Test: `backend/tests/services/test_llm_config_pagination.py`

- [ ] **Step 1: Add pagination repository helpers**

In `backend/app/repositories/llm_config_repository.py`, update imports:

```python
from sqlalchemy import func, or_, select, update
```

Add private query builder and public count/list methods:

```python
    def _employee_visible_query(self, employee_id: int, dept_ids: list[int], keyword: str | None = None, biz_type: str | None = None, status: int | None = None):
        conditions = [(LlmModelConfig.biz_type == "employee") & (LlmModelConfig.biz_id == employee_id)]
        if dept_ids:
            conditions.append((LlmModelConfig.biz_type == "dept") & (LlmModelConfig.biz_id.in_(dept_ids)))
        query = select(LlmModelConfig).where(LlmModelConfig.is_deleted == 0, or_(*conditions))
        if keyword:
            like_keyword = f"%{keyword}%"
            query = query.where(or_(LlmModelConfig.config_name.like(like_keyword), LlmModelConfig.model_name.like(like_keyword), LlmModelConfig.base_url.like(like_keyword)))
        if biz_type:
            query = query.where(LlmModelConfig.biz_type == biz_type)
        if status is not None:
            query = query.where(LlmModelConfig.status == status)
        return query

    async def count_employee_visible(self, employee_id: int, dept_ids: list[int], keyword: str | None = None, biz_type: str | None = None, status: int | None = None) -> int:
        query = self._employee_visible_query(employee_id, dept_ids, keyword, biz_type, status).with_only_columns(func.count(LlmModelConfig.id)).order_by(None)
        result = await self.db.execute(query)
        return result.scalar() or 0

    async def list_employee_visible(self, employee_id: int, dept_ids: list[int], skip: int, limit: int, keyword: str | None = None, biz_type: str | None = None, status: int | None = None) -> list[LlmModelConfig]:
        query = self._employee_visible_query(employee_id, dept_ids, keyword, biz_type, status)
        result = await self.db.execute(query.order_by(LlmModelConfig.update_time.desc(), LlmModelConfig.id.desc()).offset(skip).limit(limit))
        return result.scalars().all()
```

- [ ] **Step 2: Update service list method**

In `backend/app/services/llm_config_service.py`, replace `list_configs` signature and body:

```python
    # 分页查询当前员工可见的个人和部门模型配置，并标记是否可管理
    async def list_configs(
        self,
        current_user: dict,
        page: int = 1,
        page_size: int = 20,
        keyword: str | None = None,
        biz_type: str | None = None,
        status: int | None = None,
    ) -> dict:
        employee_id = self._current_employee_id(current_user)
        dept_ids = await self._employee_dept_ids(employee_id)
        skip = (page - 1) * page_size
        total = await self.llm_repo.count_employee_visible(employee_id, dept_ids, keyword, biz_type, status)
        configs = await self.llm_repo.list_employee_visible(employee_id, dept_ids, skip, page_size, keyword, biz_type, status)
        items = []
        for config in configs:
            item = LlmConfigItem.model_validate(config)
            item.can_manage = await self._can_manage_config(config, current_user)
            items.append(item)
        return {"total": total, "items": items}
```

In create/update payload handling, include default runtime fields from request:

```python
runtime_keys = {
    "enable_thinking",
    "enable_tools",
    "enable_prompt_cache",
    "enable_memory",
    "temperature",
    "top_p",
    "max_tokens",
    "presence_penalty",
    "frequency_penalty",
}
```

For `create_config`, add each field to payload from body. For `update_config`, existing `body.model_dump(exclude_unset=True)` will carry optional fields automatically.

- [ ] **Step 3: Change endpoint response to `PageData`**

In `backend/app/api/v1/endpoints/agent.py`, replace list endpoint:

```python
@llm_router.get("/llm-configs", response_model=ApiResponse[PageData])
async def list_llm_configs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, max_length=100),
    biz_type: str | None = Query(None, pattern="^(employee|dept)$"),
    status: int | None = Query(None, ge=0, le=1),
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    return ApiResponse(data=PageData(**await service.list_configs(current_user, page, page_size, keyword, biz_type, status)))
```

- [ ] **Step 4: Create structural pagination test**

Create `backend/tests/services/test_llm_config_pagination.py`:

```python
import inspect

from app.api.v1.endpoints import agent
from app.services.llm_config_service import LlmConfigService


def test_llm_config_list_endpoint_returns_page_data():
    route = next(route for route in agent.llm_router.routes if getattr(route, "path", None) == "/llm-configs")
    assert "PageData" in str(route.response_model)


def test_llm_config_service_list_configs_accepts_pagination_filters():
    signature = inspect.signature(LlmConfigService.list_configs)
    assert "page" in signature.parameters
    assert "page_size" in signature.parameters
    assert "keyword" in signature.parameters
    assert "biz_type" in signature.parameters
    assert "status" in signature.parameters
```

- [ ] **Step 5: Run focused tests and syntax validation**

Run from `backend`:

```powershell
python -m pytest tests\services\test_llm_config_pagination.py -q
python -m py_compile app\api\v1\endpoints\agent.py app\services\llm_config_service.py app\repositories\llm_config_repository.py
```

Expected: tests pass and py_compile exits 0.

- [ ] **Step 6: Commit pagination changes**

```powershell
git add -- backend/app/api/v1/endpoints/agent.py backend/app/services/llm_config_service.py backend/app/repositories/llm_config_repository.py backend/tests/services/test_llm_config_pagination.py; git commit -m "feat: paginate llm configs"
```

---

## Task 5: Runtime config API endpoints and Agent execution integration

**Files:**
- Modify: `backend/app/api/v1/endpoints/agent.py`
- Modify: `backend/app/services/agent_service.py`
- Modify: `backend/app/repositories/agent_repository.py`
- Modify: `backend/app/llm/graphs/agent_runtime_graph.py`
- Modify if needed: `backend/app/llm/model_router.py`, `backend/app/llm/gateway.py`

- [ ] **Step 1: Wire service dependency**

In `backend/app/api/v1/endpoints/agent.py`, import repository/service:

```python
from app.repositories.agent_user_model_runtime_config_repository import AgentUserModelRuntimeConfigRepository
from app.schemas.agent.request import AgentRuntimeConfigUpdate
from app.schemas.agent.response import AgentUserModelRuntimeConfigItem
from app.services.agent_runtime_config_service import AgentRuntimeConfigService, ENV_DEFAULT_MODEL_KEY
```

Add dependency:

```python
def get_agent_runtime_config_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> AgentRuntimeConfigService:
    llm_service = LlmConfigService(LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache)
    return AgentRuntimeConfigService(AgentUserModelRuntimeConfigRepository(db), llm_service)
```

Update `get_agent_service` so `AgentService` receives runtime config service:

```python
runtime_config_service = AgentRuntimeConfigService(AgentUserModelRuntimeConfigRepository(db), llm_service)
return AgentService(
    AgentRepository(db),
    llm_service,
    context_service,
    runtime_config_service=runtime_config_service,
    job_repo=JobRepository(db),
    app_repo=ApplicationRepository(db),
    eval_repo=EvalRepository(db),
)
```

- [ ] **Step 2: Add runtime config endpoints**

Add helpers and endpoints:

```python
def _decode_model_name(model_name: str) -> str | None:
    return None if model_name == ENV_DEFAULT_MODEL_KEY else model_name


@agent_router.get("/model-runtime-configs/recent", response_model=ApiResponse[AgentUserModelRuntimeConfigItem])
async def get_recent_model_runtime_config(
    service: AgentRuntimeConfigService = Depends(get_agent_runtime_config_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentUserModelRuntimeConfigItem]:
    return ApiResponse(data=await service.get_recent_or_default(current_user))


@agent_router.get("/model-runtime-configs/{model_name}", response_model=ApiResponse[AgentUserModelRuntimeConfigItem])
async def get_model_runtime_config(
    model_name: str,
    service: AgentRuntimeConfigService = Depends(get_agent_runtime_config_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentUserModelRuntimeConfigItem]:
    return ApiResponse(data=await service.get_or_init_model_config(current_user, _decode_model_name(model_name)))


@agent_router.put("/model-runtime-configs/{model_name}", response_model=ApiResponse[AgentUserModelRuntimeConfigItem])
async def update_model_runtime_config(
    model_name: str,
    body: AgentRuntimeConfigUpdate,
    service: AgentRuntimeConfigService = Depends(get_agent_runtime_config_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentUserModelRuntimeConfigItem]:
    return ApiResponse(message="保存成功", data=await service.update_model_config(current_user, _decode_model_name(model_name), body))


@agent_router.put("/model-runtime-configs/{model_name}/select", response_model=ApiResponse[AgentUserModelRuntimeConfigItem])
async def select_recent_model_runtime_config(
    model_name: str,
    service: AgentRuntimeConfigService = Depends(get_agent_runtime_config_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentUserModelRuntimeConfigItem]:
    return ApiResponse(message="选择成功", data=await service.select_model(current_user, _decode_model_name(model_name)))
```

Keep existing `/sessions/{session_id}/select-model` for compatibility, but make it call the new service behavior.

- [ ] **Step 3: Update `AgentService` constructor and selection flow**

In `backend/app/services/agent_service.py`, import:

```python
from app.services.agent_runtime_config_service import AgentRuntimeConfigService
```

Change constructor:

```python
        runtime_config_service: AgentRuntimeConfigService | None = None,
```

Set:

```python
        self._runtime_config_service = runtime_config_service
```

Update `create_session` so if `body.selected_model_name` is absent and runtime service exists, use recent model:

```python
        selected_model_name = body.selected_model_name
        selected_model_source = None
        if self._runtime_config_service and selected_model_name is None:
            recent_config = await self._runtime_config_service.get_recent_or_default(current_user)
            selected_model_name = None if recent_config.model_name == "__env_default__" else recent_config.model_name
            selected_model_source = recent_config.model_source
        elif selected_model_name:
            runtime_config = await self._llm_service.get_runtime_config(current_user, selected_model_name)
            selected_model_source = runtime_config.source
```

Pass `selected_model_name=selected_model_name` to repository.

Update `select_model` to call runtime service after validating model:

```python
        personal_config = None
        if self._runtime_config_service:
            personal_config = await self._runtime_config_service.select_model(current_user, model_name)
        runtime_config = await self._llm_service.get_runtime_config(current_user, model_name)
        selected_model_source = personal_config.model_source if personal_config else runtime_config.source
```

- [ ] **Step 4: Resolve effective runtime config for send/stream**

Add helper in `AgentService`:

```python
    async def _resolve_effective_runtime_config(self, session, current_user: dict):
        connection_config = await self._llm_service.get_runtime_config(current_user, session.selected_model_name)
        personal_config = None
        if self._runtime_config_service:
            personal_config = await self._runtime_config_service.select_model(current_user, session.selected_model_name)
        if not personal_config:
            return connection_config, None
        merged_extra_body = dict(connection_config.extra_body or {})
        if personal_config.extra_body:
            merged_extra_body.update(personal_config.extra_body)
        merged_extra_body["enable_thinking"] = personal_config.enable_thinking
        connection_config.extra_body = merged_extra_body
        connection_config.enable_thinking = personal_config.enable_thinking
        connection_config.enable_tools = personal_config.enable_tools
        connection_config.enable_prompt_cache = personal_config.enable_prompt_cache
        connection_config.enable_memory = personal_config.enable_memory
        connection_config.temperature = personal_config.temperature
        connection_config.top_p = personal_config.top_p
        connection_config.max_tokens = personal_config.max_tokens
        connection_config.presence_penalty = personal_config.presence_penalty
        connection_config.frequency_penalty = personal_config.frequency_penalty
        return connection_config, personal_config
```

Use this helper in `send_message` and `stream_message` instead of directly calling `self._llm_service.get_runtime_config(...)`.

- [ ] **Step 5: Respect memory and prompt-cache switches**

Change `_prepare_prompt` signature:

```python
        runtime_config: LLMRuntimeConfigDTO | None = None,
```

At the top of `_prepare_prompt`, before memory operations:

```python
        if runtime_config and not runtime_config.enable_memory:
            replay_payload = {
                "raw_content": body.content,
                "context_refs": body.context_refs,
                "resolved_prompt": body.content,
                "memory_disabled": True,
                "prompt_cache_enabled": bool(runtime_config.enable_prompt_cache),
                "user_message_id": user_message.id,
            }
            await self._agent_repo.update_run(run.id, input_payload=replay_payload)
            return body.content, session_title, replay_payload
```

When context service builds replay payload, merge:

```python
        replay_payload["prompt_cache_enabled"] = bool(runtime_config.enable_prompt_cache) if runtime_config else False
```

Ensure no prompt prefix cache read/write occurs in `AgentContextService` when `enable_prompt_cache=false`. If current cache use is inside `AgentContextService.build_prompt` or related helpers, add an explicit boolean parameter and guard cache operations.

- [ ] **Step 6: Record runtime snapshot in run input payload**

Add helper in `AgentService`:

```python
    def _runtime_snapshot(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        return {
            "selected_model_name": runtime_config.model_name,
            "model_source": runtime_config.source,
            "enable_thinking": runtime_config.enable_thinking,
            "enable_tools": runtime_config.enable_tools,
            "enable_prompt_cache": runtime_config.enable_prompt_cache,
            "enable_memory": runtime_config.enable_memory,
            "temperature": runtime_config.temperature,
            "top_p": runtime_config.top_p,
            "max_tokens": runtime_config.max_tokens,
            "presence_penalty": runtime_config.presence_penalty,
            "frequency_penalty": runtime_config.frequency_penalty,
            "extra_body": runtime_config.extra_body,
        }
```

After `_prepare_prompt`, update run payload:

```python
        replay_payload = replay_payload or {"raw_content": body.content, "context_refs": body.context_refs}
        replay_payload["runtime_config"] = self._runtime_snapshot(runtime_config)
        await self._agent_repo.update_run(run.id, input_payload=replay_payload)
```

- [ ] **Step 7: Disable tools in graph**

In `AgentService._build_tool_context`, include:

```python
            "tools_enabled": context.get("runtime_config", {}).get("enable_tools", True),
```

In `backend/app/llm/graphs/agent_runtime_graph.py`, before tool planning/execution, add a guard equivalent to:

```python
        if state.tool_context.get("tools_enabled") is False:
            return state
```

Place the guard in the node that decides or executes tools so no tool calls are emitted when disabled.

- [ ] **Step 8: Run syntax validation**

Run from `backend`:

```powershell
python -m py_compile app\api\v1\endpoints\agent.py app\services\agent_service.py app\services\agent_context_service.py app\llm\graphs\agent_runtime_graph.py app\llm\model_router.py app\llm\gateway.py
```

Expected: exit code 0.

- [ ] **Step 9: Commit Agent runtime integration**

```powershell
git add -- backend/app/api/v1/endpoints/agent.py backend/app/services/agent_service.py backend/app/services/agent_context_service.py backend/app/llm/graphs/agent_runtime_graph.py backend/app/llm/model_router.py backend/app/llm/gateway.py; git commit -m "feat: apply personal runtime config to agent runs"
```

---

## Task 6: Frontend types and API clients

**Files:**
- Modify: `frontend/src/types/agent.ts`
- Modify: `frontend/src/api/employee/agent.ts`

- [ ] **Step 1: Add TypeScript runtime config types**

In `frontend/src/types/agent.ts`, add:

```ts
export interface IAgentRuntimeConfigPayload {
  enable_thinking: boolean;
  enable_tools: boolean;
  enable_prompt_cache: boolean;
  enable_memory: boolean;
  temperature: number;
  top_p: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  extra_body?: Record<string, unknown> | null;
}

export interface IAgentUserModelRuntimeConfig extends IAgentRuntimeConfigPayload {
  id?: number | null;
  employee_id: number;
  model_name: string;
  model_source: string;
  llm_config_id?: number | null;
  last_used_at?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

export interface ILlmConfigQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  biz_type?: 'employee' | 'dept';
  status?: 0 | 1;
}

export interface IPageData<T> {
  total: number;
  items: T[];
}
```

Extend `ILlmConfigItem` and `ILlmConfigPayload` with the runtime fields.

- [ ] **Step 2: Add API methods**

In `frontend/src/api/employee/agent.ts`, update imports:

```ts
import type { IAgentReply, IAgentRuntimeConfigPayload, IAgentSessionDetail, IAgentStreamEvent, ILlmConfigPayload, ILlmConfigQuery } from '@/types/agent';
```

Add helper:

```ts
const ENV_DEFAULT_MODEL_KEY = '__env_default__';
const encodeRuntimeModelName = (modelName: string | null | undefined) => encodeURIComponent(modelName || ENV_DEFAULT_MODEL_KEY);
```

Update LLM list:

```ts
listConfigs: (params?: ILlmConfigQuery) => client.get('/employee/llm-configs', { params }),
```

Add Agent runtime APIs:

```ts
getRecentModelRuntimeConfig: () => client.get('/employee/agent/model-runtime-configs/recent'),
getModelRuntimeConfig: (modelName?: string | null) => client.get(`/employee/agent/model-runtime-configs/${encodeRuntimeModelName(modelName)}`),
updateModelRuntimeConfig: (modelName: string | null | undefined, data: IAgentRuntimeConfigPayload) => client.put(`/employee/agent/model-runtime-configs/${encodeRuntimeModelName(modelName)}`, data),
selectRuntimeModel: (modelName?: string | null) => client.put(`/employee/agent/model-runtime-configs/${encodeRuntimeModelName(modelName)}/select`),
selectModel: (id: number, model_name: string | null) => client.post(`/employee/agent/sessions/${id}/select-model`, { model_name }),
```

- [ ] **Step 3: Run TypeScript validation**

Run from `frontend`:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
```

Expected: type errors likely remain until page code is updated, but no syntax parse error in modified type/API files. If TypeScript fails only because consumers still expect old `listConfigs`, continue to Task 7 before committing.

- [ ] **Step 4: Commit with Task 7 if types break consumers**

If `tsc` passes now, commit:

```powershell
git add -- frontend/src/types/agent.ts frontend/src/api/employee/agent.ts; git commit -m "feat: add agent runtime config client types"
```

If `tsc` fails due to `llm-configs.tsx`, do not commit yet; include these files in Task 7 commit.

---

## Task 7: Frontend LLM config management pagination and default runtime controls

**Files:**
- Modify: `frontend/src/pages/employee/llm-configs.tsx`
- Create as needed: `frontend/src/components/employee/llm-configs/runtime-parameter-fields.tsx`

- [ ] **Step 1: Define default runtime form state**

In `frontend/src/pages/employee/llm-configs.tsx`, add defaults near current initial form data:

```ts
const DEFAULT_RUNTIME_PARAMS = {
  enable_thinking: false,
  enable_tools: true,
  enable_prompt_cache: false,
  enable_memory: true,
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2048,
  presence_penalty: 0,
  frequency_penalty: 0,
  extra_body: null as Record<string, unknown> | null,
};
```

Ensure create payload includes these fields.

- [ ] **Step 2: Replace client-side filtering with backend query state**

Use local input state and debounced query:

```ts
const [keywordInput, setKeywordInput] = useState('');
const debouncedKeyword = useDebounce(keywordInput, 400);
const [scopeFilter, setScopeFilter] = useState<'all' | 'employee' | 'dept'>('all');
const [statusFilter, setStatusFilter] = useState<'all' | '0' | '1'>('all');
const [page, setPage] = useState(1);
const [total, setTotal] = useState(0);
const [hasMore, setHasMore] = useState(true);
const [loadingMore, setLoadingMore] = useState(false);
```

Build query:

```ts
const buildQuery = (nextPage: number) => ({
  page: nextPage,
  page_size: 20,
  keyword: debouncedKeyword || undefined,
  biz_type: scopeFilter === 'all' ? undefined : scopeFilter,
  status: statusFilter === 'all' ? undefined : Number(statusFilter) as 0 | 1,
});
```

- [ ] **Step 3: Implement paginated loader**

Replace `loadData` with:

```ts
const loadData = async (nextPage = 1, append = false) => {
  if (append) setLoadingMore(true); else setLoading(true);
  setErrorMessage('');
  try {
    const response = await employeeLlmApi.listConfigs(buildQuery(nextPage));
    const pageData = response.data;
    setConfigs((current) => append ? [...current, ...pageData.items] : pageData.items);
    setTotal(pageData.total);
    setPage(nextPage);
    setHasMore(nextPage * 20 < pageData.total);
  } catch (error) {
    setErrorMessage(getRequestErrorMessage(error, '加载模型配置失败。'));
  } finally {
    setLoading(false);
    setLoadingMore(false);
  }
};
```

- [ ] **Step 4: Add throttled infinite scroll**

Add a sentinel ref and throttled callback:

```ts
const listEndRef = useRef<HTMLDivElement | null>(null);
const loadMore = useThrottleCallback(() => {
  if (loading || loadingMore || !hasMore) return;
  void loadData(page + 1, true);
}, 800);

useEffect(() => {
  const node = listEndRef.current;
  if (!node) return;
  const observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) loadMore();
  }, { rootMargin: '160px' });
  observer.observe(node);
  return () => observer.disconnect();
}, [loadMore]);
```

Render after list:

```tsx
<div ref={listEndRef} className="py-3 text-center text-xs text-slate-500">
  {loadingMore ? '加载更多模型配置中...' : hasMore ? '继续下滑加载更多' : total > 0 ? '已加载全部模型配置' : ''}
</div>
```

- [ ] **Step 5: Add parameter controls to config dialog**

In `ConfigDialog`, add Switch/slider/number controls for:

- `enable_thinking`
- `enable_tools`
- `enable_prompt_cache`
- `enable_memory`
- `temperature`
- `top_p`
- `max_tokens`
- `presence_penalty`
- `frequency_penalty`

Use existing UI components. If no slider exists, use `input type="range"` with Tailwind classes and a numeric input beside it:

```tsx
<input type="range" min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => updateForm('temperature', Number(event.target.value))} className="w-full accent-sky-600" />
<Input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => updateForm('temperature', Number(event.target.value))} />
```

Add recommended value marker text such as `推荐 0.7` next to the label.

- [ ] **Step 6: Refresh safely after create/update/delete/test**

After successful create/update/delete/test, call:

```ts
await loadData(1, false);
```

Do not append after mutation.

- [ ] **Step 7: Run frontend validation**

Run from `frontend`:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
npm.cmd run build
```

Expected: both pass.

- [ ] **Step 8: Commit frontend LLM page changes**

```powershell
git add -- frontend/src/types/agent.ts frontend/src/api/employee/agent.ts frontend/src/pages/employee/llm-configs.tsx frontend/src/components/employee/llm-configs; git commit -m "feat: add paginated llm config management"
```

---

## Task 8: Frontend Agent workspace runtime UI and markdown/tool timeline polish

**Files:**
- Modify: `frontend/src/pages/employee/agent.tsx`
- Create as needed: `frontend/src/components/employee/agent/agent-runtime-config-panel.tsx`
- Create as needed: `frontend/src/components/employee/agent/agent-markdown-content.tsx`
- Create as needed: `frontend/src/components/employee/agent/agent-tool-call-timeline.tsx`

- [ ] **Step 1: Add runtime config loading state**

In `agent.tsx`, add state:

```ts
const [runtimeConfig, setRuntimeConfig] = useState<IAgentUserModelRuntimeConfig | null>(null);
const [runtimeSaving, setRuntimeSaving] = useState(false);
const [leftCollapsed, setLeftCollapsed] = useState(false);
const [rightCollapsed, setRightCollapsed] = useState(false);
```

On initial page load:

```ts
const loadRuntimeConfig = async (modelName?: string | null) => {
  const response = modelName === undefined
    ? await employeeAgentApi.getRecentModelRuntimeConfig()
    : await employeeAgentApi.getModelRuntimeConfig(modelName);
  setRuntimeConfig(response.data);
};
```

Call `await loadRuntimeConfig()` with existing options/session bootstrap.

- [ ] **Step 2: Update model selection behavior**

When selecting a model in Agent workspace:

```ts
const handleSelectModel = async (modelName: string | null) => {
  if (!currentSessionId) return;
  await employeeAgentApi.selectModel(currentSessionId, modelName);
  await employeeAgentApi.selectRuntimeModel(modelName);
  await loadRuntimeConfig(modelName);
  await loadSession(currentSessionId);
};
```

This preserves session selection and updates user+model recent config.

- [ ] **Step 3: Add runtime config save handler**

```ts
const saveRuntimeConfig = async (patch: Partial<IAgentRuntimeConfigPayload>) => {
  if (!runtimeConfig) return;
  const nextConfig = { ...runtimeConfig, ...patch };
  setRuntimeConfig(nextConfig);
  setRuntimeSaving(true);
  try {
    const modelName = nextConfig.model_name === '__env_default__' ? null : nextConfig.model_name;
    const response = await employeeAgentApi.updateModelRuntimeConfig(modelName, nextConfig);
    setRuntimeConfig(response.data);
  } catch (error) {
    setErrorMessage(getRequestErrorMessage(error, '保存模型运行配置失败。'));
  } finally {
    setRuntimeSaving(false);
  }
};
```

Use this handler from the right-side config panel switches/sliders.

- [ ] **Step 4: Ensure Agent page does not render AdminLayout title card**

Use `AdminLayout` without `title`:

```tsx
<AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: 'Agent 工作台' }]}>
```

Do not pass `title="Agent 工作台"`.

- [ ] **Step 5: Add collapsible left and right panels**

Wrap current left sidebar classes with conditional width:

```tsx
<aside className={cn('transition-all duration-200', leftCollapsed ? 'w-16' : 'w-72')}>
```

Wrap right panel similarly:

```tsx
<aside className={cn('transition-all duration-200', rightCollapsed ? 'w-14' : 'w-80')}>
```

Provide visible buttons with `ChevronLeft` / `ChevronRight` from Lucide.

- [ ] **Step 6: Render Agent messages with markdown**

Create `frontend/src/components/employee/agent/agent-markdown-content.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';

export function AgentMarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-p:leading-7 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
```

Use it only for assistant messages. Keep user messages as plain text.

- [ ] **Step 7: Add inline tool-call timeline mapping**

If current stream state has `tool_call` / `tool_result` events, derive timeline items:

```ts
interface ToolTimelineItem {
  key: string;
  name: string;
  status: 'running' | 'success' | 'failed';
  message?: string;
}
```

On `tool_call`, append running. On `tool_result`, update matching tool by `tool_name` to success/failed.

Render with blue pulsing dot for running:

```tsx
<span className={cn('h-2 w-2 rounded-full', item.status === 'running' ? 'animate-pulse bg-sky-500' : item.status === 'success' ? 'bg-emerald-500' : 'bg-rose-500')} />
```

- [ ] **Step 8: Run frontend validation**

Run from `frontend`:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
npm.cmd run build
```

Expected: both pass.

- [ ] **Step 9: Commit Agent workspace UI/runtime changes**

```powershell
git add -- frontend/src/pages/employee/agent.tsx frontend/src/components/employee/agent; git commit -m "feat: add agent runtime config workspace ui"
```

---

## Task 9: Full verification and final cleanup

**Files:**
- Review changed files only.

- [ ] **Step 1: Run backend syntax checks**

Run from `backend`:

```powershell
python -m py_compile app\models\llm_model_config.py app\models\agent_user_model_runtime_config.py app\repositories\agent_user_model_runtime_config_repository.py app\repositories\llm_config_repository.py app\services\agent_runtime_config_service.py app\services\llm_config_service.py app\services\agent_service.py app\api\v1\endpoints\agent.py
```

Expected: exit code 0.

- [ ] **Step 2: Run backend focused tests**

Run from `backend`:

```powershell
python -m pytest tests\services\test_agent_runtime_config_service.py tests\services\test_llm_config_pagination.py -q
```

Expected: all focused tests pass.

- [ ] **Step 3: Run frontend checks**

Run from `frontend`:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
npm.cmd run build
```

Expected: both pass.

- [ ] **Step 4: Run whitespace check**

Run from workspace root:

```powershell
git diff --check
```

Expected: no errors. Windows LF-to-CRLF warnings are acceptable if no whitespace errors are reported.

- [ ] **Step 5: Verify DDL-first history**

Run from workspace root:

```powershell
git log --oneline -5
```

Expected: the DDL commit `db: add agent runtime config ddl` appears before backend/frontend implementation commits.

- [ ] **Step 6: Commit final cleanup if needed**

If validation required small fixes, inspect the exact changed files first:

```powershell
git status --short
```

Then stage only the files reported by `git status --short` that belong to this Agent/LLM runtime config implementation. Use an explicit command such as:

```powershell
git add -- backend/app/services/agent_service.py frontend/src/pages/employee/agent.tsx; git commit -m "fix: stabilize agent runtime config integration"
```

If no fixes were needed, do not create an empty commit.

---

## Self-review checklist

- Spec coverage:
  - DDL first requirement: Task 1.
  - Model default runtime params: Tasks 1, 2, 4, 7.
  - User personal employee+model runtime config: Tasks 1, 2, 3, 5, 6, 8.
  - Last selected model persistence: Tasks 3, 5, 8.
  - Prompt-cache switch: Tasks 1, 2, 5, 7, 8.
  - LLM config pagination: Tasks 4, 6, 7.
  - Agent workspace layout/markdown/tool timeline: Task 8.
  - Verification: Task 9.
- Placeholder scan: no unfinished marker or unspecified implementation step remains.
- Type consistency:
  - Backend table/model/schema name: `agent_user_model_runtime_config` / `AgentUserModelRuntimeConfig` / `AgentUserModelRuntimeConfigItem`.
  - Frontend default env key: `__env_default__`.
  - Prompt cache flag: `enable_prompt_cache` everywhere.
