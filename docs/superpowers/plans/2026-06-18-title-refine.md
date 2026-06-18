# 会话标题异步精化 + 中文输出约束 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有的"首条消息自动设置默认标题"基础上，新增 Celery 异步任务，基于用户首条问题用 LLM 生成 ≤20 字的中文精化标题；同时在所有面向用户的 Prompt 模板中显式约束输出语言必须为简体中文。

**Architecture:** 服务层 `_create_user_message` 在落库默认标题后立即 `.delay()` 投递 Celery 任务（try/except 兜底），任务在 worker 端用 sync MySQL 双重校验默认态后调 `LLMModelRouter.complete()`，后处理（去标点 + 截 20 字）后落库。前端零改动，用户切换/刷新会话时自然拿到新标题。中文约束统一追加到 `agent/constraints.yaml`（8 个模板通过 include 自动生效）+ `agent/system.yaml` 单独追加。

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.x / Celery / asyncio / pytest / Jinja2 (SandboxedEnvironment) / Redis (Celery broker)

---

## 文件结构

**新建：**
- `backend/app/llm/prompts/templates/agent/title_refine.yaml` — 标题精化 Prompt 模板
- `backend/app/workers/tasks/agent_task.py` — Agent 相关 Celery 任务集合（首批仅含 `refine_session_title_task`）
- `backend/tests/workers/__init__.py` — workers 测试包初始化（如不存在）
- `backend/tests/workers/test_agent_task.py` — `agent_task` 单元测试

**修改：**
- `backend/app/llm/prompts/templates/agent/constraints.yaml` — 末尾追加「输出语言」段
- `backend/app/llm/prompts/templates/agent/system.yaml` — 在「交互规范」之后追加「输出语言」段
- `backend/app/workers/celery_app.py` — `include` 追加新任务模块；`task_routes` 新增 `agent` 队列路由
- `backend/app/services/agent_runtime_service.py` — `_create_user_message` 签名追加 `runtime_config`，落库默认标题后 try/except 调 `.delay()`；`stream_message` 调用处透传

---

## Task 1：新增标题精化 Prompt 模板

**Files:**
- Create: `backend/app/llm/prompts/templates/agent/title_refine.yaml`

- [ ] **Step 1：创建模板文件**

写入 `backend/app/llm/prompts/templates/agent/title_refine.yaml`：

```yaml
name: title_refine
version: "1.0"
description: "异步精化会话标题：基于用户首条问题生成 ≤20 字的中文标题"
variables:
  - name: user_content
    required: true
    description: "用户首条问题原文"
template: |-
  你的任务是为 HR 招聘助手会话生成一个简洁的中文标题。

  # 用户首条问题
  {{ user_content }}

  # 输出要求
  - 必须使用简体中文
  - 严格控制在 20 个汉字以内
  - 概括用户意图核心，不要复述完整问题
  - 不要使用任何标点符号、引号、括号、emoji、空格
  - 不要出现"会话""标题""问题""请""帮我"等元词
  - 直接输出标题文本，不要任何前缀、后缀或解释

  # 标题
```

> 注意：模板末尾刻意没有换行 + 没有前缀，让模型紧贴 `# 标题` 之后输出，便于解析。
> 不通过 `{% include "agent/constraints.yaml" %}`：本模板输出极短，复杂约束反而稀释指令。

- [ ] **Step 2：用 PromptManager 渲染验证**

在 worktree 根目录执行（确认渲染不报错且占位符替换正确）：

```bash
cd backend && python -c "from app.llm.prompts.manager import prompt_manager; print(prompt_manager.render('agent/title_refine', user_content='帮我评估一下张三这份候选人简历，重点看技术能力'))"
```

Expected：输出包含「用户首条问题」段并且 `张三` 出现在其中；不报 Jinja 错误；末尾以 `# 标题` 结束。

- [ ] **Step 3：提交**

```bash
git add backend/app/llm/prompts/templates/agent/title_refine.yaml
git commit -m "feat(agent-be): 新增 agent/title_refine.yaml 标题精化提示词"
```

---

## Task 2：在 constraints.yaml 追加「输出语言」段

**Files:**
- Modify: `backend/app/llm/prompts/templates/agent/constraints.yaml`

- [ ] **Step 1：追加输出语言约束**

将 `agent/constraints.yaml` 整体替换为：

```yaml
name: constraints
version: "1.0"
description: "共享约束规则片段，供其他模板通过 Jinja2 include 引用"
template: |-
  ## 禁止事项
  - 禁止编造不存在的信息，所有结论必须来自输入数据中的直接证据
  - 禁止在未获得用户确认前执行不可逆操作
  - 禁止假设用户意图或遗漏必要信息，不明确时必须先询问
  - 禁止代替用户做出最终决策

  ## 确定性要求
  - 禁止使用"可能"、"也许"、"大概"、"似乎"、"或许"、"不确定"、"一定程度"、"相对"、"较好"、"不错"、"有机会"、"可考虑"等弱判断表达
  - 结论必须确定、具体、可审计
  - 优势必须来自输入数据的直接证据
  - 缺失证据时必须保守判断并明确标注"未体现"或"信息不足"

  ## 输出语言
  - 所有面向用户的输出必须使用简体中文
  - 当输出 JSON 时，所有自然语言字段（如 advantage、disadvantage、reason、comment、question 等）也必须为简体中文
  - 禁止中英文混杂；专有名词例外（如 React、Python、Vue、SQL 等技术名词原样保留）
```

- [ ] **Step 2：渲染验证 include 链路仍然正常**

```bash
cd backend && python -c "from app.llm.prompts.manager import prompt_manager; out = prompt_manager.render('evaluation/dimension_eval', job_name='测试岗', job_description='', dimension={}, skill_hits=[], resume_text=''); print('OK' if '输出语言' in out and '简体中文' in out else 'FAIL'); print(out[:500])"
```

Expected：打印 `OK` 且模板内容里能看到「输出语言」段被 include 进来。

- [ ] **Step 3：提交**

```bash
git add backend/app/llm/prompts/templates/agent/constraints.yaml
git commit -m "feat(agent-be): constraints.yaml 追加输出语言中文约束"
```

---

## Task 3：在 system.yaml 追加「输出语言」段

**Files:**
- Modify: `backend/app/llm/prompts/templates/agent/system.yaml`

- [ ] **Step 1：追加输出语言段**

在 `agent/system.yaml` 的「## 交互规范」段之后、空行之前插入「## 输出语言」段。修改后该模板的「行为约束」节如下：

```yaml
template: |-
  # 角色
  你是一名专业的 HR 招聘助手，拥有丰富的招聘经验和候选人评估能力。
  你的目标是帮助企业高效地完成招聘流程，提升候选人体验和招聘质量。

  # 核心能力
  - 候选人分析与评估：分析候选人的简历、技能、经验与岗位的匹配度
  - 岗位匹配度分析：比较候选人与岗位要求，识别优势和差距
  - 面试建议生成：根据候选人特点生成针对性的面试问题和建议
  - 招聘流程优化：提供招聘状态更新、流程推进建议

  # 行为约束
  ## 禁止事项
  - 禁止编造不存在的信息、数据或候选人资料
  - 禁止在未获得用户确认前执行不可逆操作
  - 禁止假设用户意图或遗漏必要信息，不明确时必须先询问
  - 禁止代替用户做出最终决策

  ## 确定性要求
  - 结论必须确定、具体、可执行
  - 禁止使用"可能"、"也许"、"大概"、"似乎"、"或许"、"不确定"、"一定程度"等弱判断表达
  - 证据不足时必须明确标注，不得以模糊表述替代

  ## 交互规范
  - 信息不足时，主动询问用户以获取必要信息
  - 明确告知用户每个操作的目的和可能的影响
  - 回复简洁明了，避免冗长

  ## 输出语言
  - 所有面向用户的输出必须使用简体中文
  - 当输出 JSON 时，所有自然语言字段（如 advantage、disadvantage、reason、comment、question 等）也必须为简体中文
  - 禁止中英文混杂；专有名词例外（如 React、Python、Vue、SQL 等技术名词原样保留）

  {{"{% if snapshot_summary %}"}}
  # 历史摘要
  {{"{{ snapshot_summary }}"}}
  {{"{% endif %}"}}
```

> 后续的 `{% if memories %}`、`{% if recent_messages %}`、`# 当前用户输入` 段保持不变。

执行 Edit 工具时，把现有 `## 交互规范` 段块替换为「现有交互规范 + 新增输出语言段」即可，其余内容不动。

- [ ] **Step 2：渲染验证**

```bash
cd backend && python -c "from app.llm.prompts.manager import prompt_manager; out = prompt_manager.render('agent/system', user_content='hi'); assert '输出语言' in out and '简体中文' in out, out; print('OK')"
```

Expected：打印 `OK`，无 AssertionError。

- [ ] **Step 3：提交**

```bash
git add backend/app/llm/prompts/templates/agent/system.yaml
git commit -m "feat(agent-be): system.yaml 追加输出语言中文约束"
```

---

## Task 4：编写 agent_task 单元测试（先红）

**Files:**
- Create: `backend/tests/workers/__init__.py`（如不存在）
- Create: `backend/tests/workers/test_agent_task.py`

- [ ] **Step 1：确保测试包目录存在**

```bash
test -f backend/tests/workers/__init__.py || (mkdir -p backend/tests/workers && touch backend/tests/workers/__init__.py)
```

- [ ] **Step 2：写测试文件**

写入 `backend/tests/workers/test_agent_task.py`：

```python
"""
agent_task 模块单元测试。

只覆盖纯函数：默认标题规则、默认态识别、后处理。
LLM 调用与 DB 双重校验依赖外部资源，由集成测试覆盖。
"""
from __future__ import annotations

import pytest

from app.workers.tasks.agent_task import (
    TITLE_MAX_LEN,
    _is_default_title,
    _make_default_title,
    _post_process,
)


class TestMakeDefaultTitle:
    """默认标题规则必须与 AgentRuntimeService._make_title_from_content 完全一致。"""

    def test_empty_returns_empty(self):
        assert _make_default_title("") == ""

    def test_strip_and_collapse_whitespace(self):
        assert _make_default_title("  hello   world  ") == "hello world"

    def test_replace_newline_and_tab(self):
        assert _make_default_title("a\nb\tc\rd") == "a b c d"

    def test_truncate_to_80_chars(self):
        content = "我" * 100
        assert _make_default_title(content) == "我" * 80

    def test_chinese_short_passes_through(self):
        assert _make_default_title("帮我评估候选人") == "帮我评估候选人"


class TestIsDefaultTitle:
    """默认态识别：占位符 / 用户问题截断态 → True；用户手动改过 → False。"""

    @pytest.mark.parametrize("placeholder", ["", "  ", "新会话", "未命名会话"])
    def test_placeholder_is_default(self, placeholder):
        assert _is_default_title(placeholder, "任意内容") is True

    def test_truncated_user_content_is_default(self):
        content = "帮我评估这份候选人简历，重点看技术能力"
        assert _is_default_title(content, content) is True

    def test_long_content_truncated_to_80_is_default(self):
        content = "很长的问题" * 40
        truncated = _make_default_title(content)
        assert _is_default_title(truncated, content) is True

    def test_user_modified_title_is_not_default(self):
        assert _is_default_title("我自己起的标题", "原始问题内容") is False

    def test_none_treated_as_empty_default(self):
        assert _is_default_title(None, "原始问题") is True


class TestPostProcess:
    """LLM 输出兜底清洗：去首尾标点 → 合并内部空白 → 截 20 字。"""

    def test_empty_input(self):
        assert _post_process("") == ""

    def test_strip_chinese_punctuation(self):
        assert _post_process("，候选人技术能力评估。") == "候选人技术能力评估"

    def test_strip_english_punctuation_and_quotes(self):
        assert _post_process('"Resume Analysis."') == "Resume Analysis"

    def test_collapse_internal_whitespace(self):
        assert _post_process("候选人 技术 评估") == "候选人技术评估"

    def test_truncate_to_max_len(self):
        raw = "候" * 30
        assert _post_process(raw) == "候" * TITLE_MAX_LEN

    def test_strip_then_truncate(self):
        raw = "  ， " + "评估" * 15 + "  。 "
        result = _post_process(raw)
        assert len(result) == TITLE_MAX_LEN
        assert not result.startswith(("，", " "))
        assert not result.endswith(("。", " "))
```

- [ ] **Step 3：运行测试，验证全部失败（模块不存在）**

```bash
cd backend && python -m pytest tests/workers/test_agent_task.py -v 2>&1 | tail -20
```

Expected：测试收集失败，错误为 `ModuleNotFoundError: No module named 'app.workers.tasks.agent_task'` 或类似。

- [ ] **Step 4：提交**

```bash
git add backend/tests/workers/__init__.py backend/tests/workers/test_agent_task.py
git commit -m "test(agent-be): 新增 agent_task 单元测试（待实现）"
```

---

## Task 5：实现 agent_task Celery 任务

**Files:**
- Create: `backend/app/workers/tasks/agent_task.py`
- Test: `backend/tests/workers/test_agent_task.py`（已存在）

- [ ] **Step 1：写 agent_task 实现**

写入 `backend/app/workers/tasks/agent_task.py`：

```python
"""
Agent 相关异步任务集合。

当前任务：
- refine_session_title_task：基于用户首条问题异步精化会话标题（≤20 字、纯中文）
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from sqlalchemy import text

from app.llm.model_router import LLMModelRouter
from app.llm.prompts.manager import prompt_manager
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.workers.celery_app import celery_app
from app.workers.db import mysql_manager_sync

logger = logging.getLogger(__name__)

# 标题最大字数（中文字符按字符计）
TITLE_MAX_LEN = 20

# DB 默认占位标题集合：与 agent_runtime_service._make_title_from_content 上游保持一致
_DEFAULT_TITLES = {"", "新会话", "未命名会话"}

# 后处理：去除首尾常见标点（中英文）、引号、括号、空白
_STRIP_PUNCTUATION = re.compile(
    r"^[\s\"'`,.;:!?，。；：！？、（）()【】\[\]\-—_]+"
    r"|[\s\"'`,.;:!?，。；：！？、（）()【】\[\]\-—_]+$"
)


def _make_default_title(content: str) -> str:
    """与 AgentRuntimeService._make_title_from_content 完全一致的默认标题规则。

    保持单一事实源：上游规则一旦变更，本函数同步更新，单元测试守住一致性。

    @param content: 用户消息原文
    @return: 单行 ≤80 字的标题文本（与 DB 列上限对齐）
    """
    if not content:
        return ""
    flat = content.strip().replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return " ".join(flat.split())[:80]


def _is_default_title(current: str | None, content: str) -> bool:
    """判断 DB 中的当前标题是否仍处于"默认态"。

    默认态包含：
    1. 空字符串、None、空白
    2. 占位符（"新会话"、"未命名会话"）
    3. 与上游 _make_title_from_content(content) 完全一致（即首次发送消息自动填的标题）

    若用户已手动改过标题（非以上任何一种），返回 False，跳过精化覆盖以保护用户意图。

    @param current: DB 中读出的当前 title
    @param content: 本次用户首条消息原文
    @return: True 表示仍为默认态，可以精化覆盖；False 表示已被用户修改，跳过
    """
    cur = (current or "").strip()
    if cur in _DEFAULT_TITLES:
        return True
    return cur == _make_default_title(content)


def _post_process(raw: str) -> str:
    """对 LLM 返回的标题做兜底清洗。

    规则：
    1. 去首尾空白
    2. 去首尾标点（中英文，引号、括号、句号、逗号、空格）
    3. 合并所有内部空白（含多空格、Tab、换行）
    4. 截 20 字（中文按字符计）

    @param raw: LLM 原始输出
    @return: 清洗后的标题；可能为空字符串（表示放弃落库）
    """
    if not raw:
        return ""
    cleaned = _STRIP_PUNCTUATION.sub("", raw.strip())
    # 合并所有内部空白（中文标题不需要空格分词）
    cleaned = "".join(cleaned.split())
    return cleaned[:TITLE_MAX_LEN]


async def _arefine(content: str, runtime_config: LLMRuntimeConfigDTO) -> str:
    """异步调用 LLM 生成精化标题。

    标题生成不需要 fallback、不需要 thinking、不需要长输出：
    复制 runtime_config 后强制覆盖关键参数以降低成本和延迟。

    @param content: 用户首条问题原文
    @param runtime_config: 透传自前端发送时的运行时配置（含 model_name / api_key / base_url 等）
    @return: 后处理后的标题；空字符串表示放弃
    """
    prompt = prompt_manager.render("agent/title_refine", user_content=content)
    # 复制并强制覆盖：标题生成关闭 thinking、关闭 fallback、限制最长 64 token
    title_config = runtime_config.model_copy(update={
        "enable_thinking": False,
        "fallback_model_name": None,
        "max_tokens": 64,
        "temperature": 0.3,
    })
    router = LLMModelRouter()
    result = await router.complete(prompt, title_config)
    return _post_process(getattr(result, "content", "") or "")


@celery_app.task(
    bind=True,
    name="app.workers.tasks.agent_task.refine_session_title_task",
    max_retries=0,                  # 不重试：失败 silent fallback 即可
    ignore_result=True,
)
def refine_session_title_task(
    self,
    session_id: int,
    user_content: str,
    runtime_config_dict: dict[str, Any],
) -> None:
    """异步精化会话标题。

    流程：
    1. 第一次双重校验：DB 当前 title 仍为默认态 → 才继续
    2. 调 LLM 生成 ≤20 字中文标题（asyncio.run 同步包装）
    3. 第二次双重校验后落库（避免与人工修改竞态）

    任何异常都仅记 warn 日志、不重试，保留默认标题作为兜底。

    @param session_id: AgentSession.id
    @param user_content: 用户首条消息原文
    @param runtime_config_dict: LLMRuntimeConfigDTO.model_dump(mode="json") 序列化后的字典
    """
    logger.info("开始精化会话标题：session_id=%s", session_id)
    try:
        # 1. 第一次双重校验：当前 title 是否仍为默认态
        with mysql_manager_sync.session() as db_session:
            row = db_session.execute(
                text("SELECT title FROM agent_session WHERE id = :sid AND is_deleted = 0"),
                {"sid": session_id},
            ).mappings().first()
        if not row:
            logger.warning("精化标题跳过：会话不存在 session_id=%s", session_id)
            return
        if not _is_default_title(row["title"], user_content):
            logger.info(
                "精化标题跳过：当前标题已被用户手动修改 session_id=%s title=%s",
                session_id, row["title"],
            )
            return

        # 2. 调 LLM
        runtime_config = LLMRuntimeConfigDTO(**runtime_config_dict)
        refined = asyncio.run(_arefine(user_content, runtime_config))
        if not refined:
            logger.warning("精化标题跳过：LLM 返回空 session_id=%s", session_id)
            return

        # 3. 第二次双重校验 + 落库
        with mysql_manager_sync.session() as db_session:
            row = db_session.execute(
                text("SELECT title FROM agent_session WHERE id = :sid AND is_deleted = 0"),
                {"sid": session_id},
            ).mappings().first()
            if not row or not _is_default_title(row["title"], user_content):
                logger.info("精化标题落库前竞态保护：session_id=%s", session_id)
                return
            db_session.execute(
                text("UPDATE agent_session SET title = :title WHERE id = :sid"),
                {"title": refined, "sid": session_id},
            )
            db_session.commit()
        logger.info("会话标题精化完成：session_id=%s title=%s", session_id, refined)
    except Exception as exc:
        # 任何异常都不抛、不重试：保留默认标题
        logger.warning("会话标题精化失败（忽略）：session_id=%s err=%s", session_id, exc)
```

- [ ] **Step 2：运行单元测试，验证全部通过**

```bash
cd backend && python -m pytest tests/workers/test_agent_task.py -v 2>&1 | tail -25
```

Expected：所有用例 PASS（默认 18 个左右；以实际数量为准）。

- [ ] **Step 3：提交**

```bash
git add backend/app/workers/tasks/agent_task.py
git commit -m "feat(agent-be): 新增 refine_session_title_task 异步标题精化任务"
```

---

## Task 6：注册 Celery 任务路由

**Files:**
- Modify: `backend/app/workers/celery_app.py`

- [ ] **Step 1：在 include 列表追加新任务模块**

在 `celery_app.py` 中找到：

```python
celery_app = Celery(
    "resume_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.workers.tasks.eval_task"]
)
```

替换为：

```python
celery_app = Celery(
    "resume_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.workers.tasks.eval_task",
        "app.workers.tasks.agent_task",
    ],
)
```

- [ ] **Step 2：在 task_routes 追加 agent 队列路由**

找到：

```python
    task_routes={
        "app.workers.tasks.eval_task.*": {"queue": "eval"}
    },
```

替换为：

```python
    task_routes={
        "app.workers.tasks.eval_task.*": {"queue": "eval"},
        "app.workers.tasks.agent_task.*": {"queue": "agent"},
    },
```

- [ ] **Step 3：导入校验**

```bash
cd backend && python -c "from app.workers.celery_app import celery_app; print('registered:', sorted([n for n in celery_app.tasks if not n.startswith('celery.')]))"
```

Expected：输出包含 `app.workers.tasks.agent_task.refine_session_title_task` 与 `app.workers.tasks.eval_task.run_evaluation_task`。

- [ ] **Step 4：提交**

```bash
git add backend/app/workers/celery_app.py
git commit -m "feat(agent-be): celery_app 注册 agent_task 任务与 agent 队列路由"
```

---

## Task 7：服务层触发点改造

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py`

- [ ] **Step 1：修改 `_create_user_message` 方法签名，追加 `runtime_config` 形参**

定位 `_create_user_message` 当前签名（在 `agent_runtime_service.py` 第 368 行附近）：

```python
    async def _create_user_message(
        self, session, body: AgentMessageCreate, *, run_id: str,
    ):
```

替换为：

```python
    async def _create_user_message(
        self, session, body: AgentMessageCreate, *, run_id: str,
        runtime_config: LLMRuntimeConfigDTO,
    ):
```

- [ ] **Step 2：在落库默认标题后追加异步任务投递**

定位 `_create_user_message` 内部以下代码段（在「自动设置会话标题」日志之后、`return msg` 之前）：

```python
        if not existing_title or existing_title in {"新会话", "未命名会话"}:
            snippet = self._make_title_from_content(body.content or "")
            if snippet:
                await self._repo.update_session(session.id, title=snippet)
                # 同步内存对象，避免后续 yield 中读到旧 title
                session.title = snippet
                logger.info(
                    "首次发送消息自动设置会话标题：session_id=%s title=%s",
                    session.id, snippet,
                )
        return msg
```

替换为：

```python
        if not existing_title or existing_title in {"新会话", "未命名会话"}:
            snippet = self._make_title_from_content(body.content or "")
            if snippet:
                await self._repo.update_session(session.id, title=snippet)
                # 同步内存对象，避免后续 yield 中读到旧 title
                session.title = snippet
                logger.info(
                    "首次发送消息自动设置会话标题：session_id=%s title=%s",
                    session.id, snippet,
                )
                # 投递 LLM 异步精化任务：基于用户首条问题生成 ≤20 字中文标题。
                # 失败（Broker 不可用、序列化异常等）静默忽略，默认标题已能用作兜底。
                try:
                    from app.workers.tasks.agent_task import refine_session_title_task
                    refine_session_title_task.delay(
                        session.id,
                        body.content or "",
                        runtime_config.model_dump(mode="json"),
                    )
                    logger.info(
                        "已投递会话标题精化任务：session_id=%s", session.id,
                    )
                except Exception:
                    logger.exception(
                        "投递会话标题精化任务失败（忽略）：session_id=%s", session.id,
                    )
        return msg
```

- [ ] **Step 3：修改 `stream_message` 中 `_create_user_message` 调用点透传 runtime_config**

定位 `stream_message` 内（第 143 行附近）：

```python
        # 落库用户消息
        user_message = await self._create_user_message(session, body, run_id=run_id)
```

替换为：

```python
        # 落库用户消息
        user_message = await self._create_user_message(
            session, body, run_id=run_id, runtime_config=runtime_config,
        )
```

> `resolve_interaction` 流程不调 `_create_user_message`（人机交互恢复时不创建新用户消息），无需改动。

- [ ] **Step 4：语法 + 导入校验**

```bash
cd backend && python -c "from app.services.agent_runtime_service import AgentRuntimeService; print('OK')"
```

Expected：输出 `OK`，无 ImportError / SyntaxError。

- [ ] **Step 5：跑现有测试套件回归**

```bash
cd backend && python -m pytest tests/ -v 2>&1 | tail -30
```

Expected：原有测试全部 PASS；本次新增的 `tests/workers/test_agent_task.py` 也全部 PASS。

- [ ] **Step 6：提交**

```bash
git add backend/app/services/agent_runtime_service.py
git commit -m "feat(agent-be): _create_user_message 异步投递标题精化任务"
```

---

## Task 8：手动集成验证

**目标：** 在真实环境跑完一次首次发送消息流程，确认默认标题立即可见、异步精化标题可见、部分异常路径符合预期。

- [ ] **Step 1：启动后端 + Celery worker（含 agent 队列）**

```bash
# 终端 1：启动 FastAPI
cd backend && python -m app.main

# 终端 2：启动 Celery worker，同时消费 eval 与 agent 两个队列
cd backend && celery -A app.workers.celery_app:celery_app worker --pool=threads -Q eval,agent -l info
```

Expected：worker 启动日志中可看到 `[tasks]` 列表里包含 `app.workers.tasks.agent_task.refine_session_title_task`。

- [ ] **Step 2：场景 A — 默认流程**

前端新建会话，发送一条 30 字以上的问题，例如：

> 帮我评估一下张三这份候选人简历，重点看一下技术能力和过往项目经验

观察：

1. 侧栏标题立即显示用户原文（截断态）
2. Celery worker 终端输出 `开始精化会话标题：session_id=...`
3. 等待 1~5 秒后，刷新会话列表 / 切走再切回当前会话
4. 标题变为 ≤20 字的中文精化版本（如 `张三技术能力评估`）

Expected：以上 4 点全部满足。

- [ ] **Step 3：场景 B — 用户竞态修改**

新建会话发送一条问题后，**立即**手动把会话标题改为 `我自己的标题`。等待 5~10 秒。

Expected：标题保持 `我自己的标题`，Celery 日志输出 `精化标题跳过：当前标题已被用户手动修改`。

- [ ] **Step 4：场景 C — Celery Broker 不可用**

停止 Celery worker，新建会话发送一条问题。

Expected：

1. 主 SSE 流正常完成，Agent 回答正常
2. 默认标题正常落库
3. 后端日志输出 `已投递会话标题精化任务` 或 `投递会话标题精化任务失败（忽略）`（取决于 Broker 是否可达）
4. 主流程没有任何报错

> 实施判断标准：即便整个 Celery 队列彻底挂掉，前端用户体感与现有版本完全一致。

- [ ] **Step 5：场景 D — 中文输出约束抽样**

在前端用纯英文向 Agent 提问：`Please summarize this resume for me`。

Expected：Agent 回答为简体中文，不出现成段英文。

再触发一次面试问题生成（图一）和简历评估（图二），抽查输出 JSON 的 `advantage`、`disadvantage`、`question` 字段是否全部为简体中文。

- [ ] **Step 6：记录验证结论**

如全部场景通过，在 commit message 中记录验证结论；如发现问题，回到对应 Task 修复后再继续。

---

## Task 9：合入与收尾

- [ ] **Step 1：rebase 同步最新 dev**

```bash
cd D:/code/py/project/resume/.claude/worktrees/title-refine && git fetch && git rebase dev
```

如有冲突按提示解决；本次改动覆盖面小，预期无冲突。

- [ ] **Step 2：跑完整测试套件**

```bash
cd backend && python -m pytest tests/ -v 2>&1 | tail -15
```

Expected：全部 PASS。

- [ ] **Step 3：使用 superpowers:finishing-a-development-branch 决定合入方式**

根据该 skill 的引导选择「合并到 dev」或「发起 PR」之一推进。

---

## 自审

**1. Spec 覆盖：**

| Spec 段落 | Plan 任务 |
| --- | --- |
| §3.1 新增 `agent/title_refine.yaml` | Task 1 |
| §3.2 新增 `agent_task.py` | Task 4 + Task 5 |
| §3.3 注册 Celery 路由 | Task 6 |
| §3.4 服务层触发点 | Task 7 |
| §3.5 中文约束（constraints.yaml） | Task 2 |
| §3.5 中文约束（system.yaml） | Task 3 |
| §7 并发与一致性 | Task 5 实现里的两次 `_is_default_title` 守卫 + Task 8 场景 B/C |
| §8 测试策略 | Task 4 单测 + Task 8 集成验证 |

无 Spec 段落缺失对应任务。

**2. 占位符扫描：** 全部任务有具体代码 / 命令 / 期望输出，无 TBD / TODO / "类似上文" 等模糊描述。

**3. 类型一致性：**

- Task 5 实现的常量名 `TITLE_MAX_LEN`、函数名 `_make_default_title` / `_is_default_title` / `_post_process` 与 Task 4 测试用例 import 一致。
- Task 5 的 `refine_session_title_task` 三参数签名 `(session_id, user_content, runtime_config_dict)` 与 Task 7 触发点 `.delay(session.id, body.content or "", runtime_config.model_dump(mode="json"))` 三参数一致。
- `_post_process` 用 `_STRIP_PUNCTUATION.sub("", raw.strip())` 一次性匹配首尾标点；测试用例 `test_strip_chinese_punctuation` / `test_strip_english_punctuation_and_quotes` 验证此行为。

无类型 / 命名漂移。
