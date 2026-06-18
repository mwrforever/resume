# 会话标题异步精化 + 中文输出约束 设计文档

日期：2026-06-18
分支：worktree-title-refine
作者：mwr / Claude

## 一、需求背景

当前会话首条消息发送时，后端 `AgentRuntimeService._create_user_message` 会用纯字符串规则
（`strip → 换行/制表符替为单空格 → 合并连续空白 → 截 80 字`）把用户问题落库为会话标题。
该规则保证了"侧边栏立即有标题可看"，但标题本身仍是用户原文截断，信息密度低、阅读成本高。

本次功能强化目标：

1. **异步标题精化**：在默认标题落库的基础上，向 Celery 投递异步任务，基于用户首条问题
   通过 LLM 生成一个语义更贴切的中文标题，精简、不超过 20 字，覆盖会话标题字段。
2. **提示词中文输出约束**：在所有面向用户的 Prompt 模板中显式约束输出语言必须为简体中文，
   避免出现中英文混杂或英文输出。

## 二、整体设计

### 2.1 流程图

```
[POST /api/v1/agent/sessions/{id}/messages]
        │
        ▼
AgentRuntimeService.stream_message
  └─ _create_user_message
       ├─ DB: 落库用户消息
       ├─ DB: 若 title 为默认/空 → set title = _make_title_from_content(content)[:80]
       └─ ★ 新增：refine_session_title_task.delay(session_id, content, runtime_config.model_dump(mode="json"))
              （try/except 兜底：Broker 不可用不阻塞主流程）
        │
        ▼ （并行，与主 SSE 完全独立）
[Celery Worker, queue=agent]
refine_session_title_task
  ├─ DB 双重校验：当前 title 仍为"默认截断态" → 才精化
  ├─ 调 LLMModelRouter.complete()（asyncio.run 同步包装）
  │    └─ 使用 prompts/templates/agent/title_refine.yaml
  ├─ 后处理：strip → 截 20 字 → 清首尾标点
  └─ DB: UPDATE agent_session SET title = refined_title
```

### 2.2 前端感知方式

**纯异步、零协议改动**。前端 `utils/title.ts` 的乐观更新逻辑保持不变；用户切走再切回当前
会话、刷新会话列表、或下次会话搜索时自然拿到 LLM 精化后的新标题。

不引入 SSE 事件、不引入轮询接口、不引入 WebSocket。理由：

- 标题精化是**锦上添花**，不是关键路径；用户当前正在看的就是会话本身（标题位于侧栏/Topbar）。
- 异步任务可能耗时 1~5 秒，实时推送会让用户在阅读 Agent 回答时看到"标题突然变化"，反而干扰。
- 实现复杂度最低，与现有 envelope 协议完全解耦，未来想加推送也能平滑增量。

## 三、后端改动清单

### 3.1 新增 Prompt 模板

**新文件** `backend/app/llm/prompts/templates/agent/title_refine.yaml`：

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
  - 不要出现"会话/标题/问题/请/帮我"等元词
  - 直接输出标题文本，不要任何前缀、后缀或解释

  # 标题
```

> 故意不通过 `{% include "agent/constraints.yaml" %}`：本模板输出极短，复杂约束反而稀释指令。

### 3.2 新增 Celery 任务

**新文件** `backend/app/workers/tasks/agent_task.py`：

```python
"""
Agent 相关异步任务集合。

当前任务：
- refine_session_title_task：基于用户首条问题异步精化会话标题
"""
from __future__ import annotations

import asyncio
import logging
import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.llm.model_router import LLMModelRouter
from app.llm.prompts.manager import prompt_manager
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.workers.celery_app import celery_app
from app.workers.db import mysql_manager_sync

logger = logging.getLogger(__name__)

# 标题最大字数（中文字符按字符计）
TITLE_MAX_LEN = 20

# DB 默认占位标题集合：与 agent_runtime_service 保持一致
_DEFAULT_TITLES = {"", "新会话", "未命名会话"}

# 后处理：去除首尾常见标点（中英文）
_STRIP_PUNCTUATION = re.compile(r"^[\s\"'`,.;:!?，。；：！？、\-—_]+|[\s\"'`,.;:!?，。；：！？、\-—_]+$")


def _make_default_title(content: str) -> str:
    """与 AgentRuntimeService._make_title_from_content 完全一致的默认标题规则。"""
    if not content:
        return ""
    flat = content.strip().replace("\r", " ").replace("\n", " ").replace("\t", " ")
    return " ".join(flat.split())[:80]


def _is_default_title(current: str, content: str) -> bool:
    """判断 DB 中的当前标题是否仍为默认态（默认占位 或 用户问题截断）。

    若用户已手动改过标题，则跳过精化覆盖，保护用户意图。
    """
    cur = (current or "").strip()
    if cur in _DEFAULT_TITLES:
        return True
    return cur == _make_default_title(content)


def _post_process(raw: str) -> str:
    """对 LLM 返回的标题做兜底清洗。"""
    if not raw:
        return ""
    # 去除首尾标点和空白
    cleaned = _STRIP_PUNCTUATION.sub("", raw.strip())
    # 合并所有内部空白
    cleaned = "".join(cleaned.split())
    # 截 20 字
    return cleaned[:TITLE_MAX_LEN]


async def _arefine(content: str, model_name: str) -> str:
    """异步调用 LLM 生成精化标题。返回 ''. 表示放弃。"""
    prompt = prompt_manager.render("agent/title_refine", user_content=content)
    runtime_config = LLMRuntimeConfigDTO(
        model_name=model_name,
        enable_thinking=False,
        # 标题生成不需要 fallback：失败就静默放弃，保留默认标题
        fallback_model_name=None,
    )
    router = LLMModelRouter()
    result = await router.complete(prompt, runtime_config)
    return _post_process(getattr(result, "content", "") or "")


@celery_app.task(
    bind=True,
    name="app.workers.tasks.agent_task.refine_session_title_task",
    max_retries=0,                 # 不重试：失败 silent fallback 即可
    ignore_result=True,
)
def refine_session_title_task(
    self, session_id: int, user_content: str, model_name: str,
) -> None:
    """异步精化会话标题。

    1. 双重校验当前 title 仍为默认态
    2. 调 LLM 生成 ≤20 字中文标题
    3. 后处理 + 落库

    任何失败都仅记 warn 日志，不重试，保留默认标题作为兜底。
    """
    logger.info("开始精化会话标题：session_id=%s", session_id)
    try:
        # 1. 读当前 title 双重校验
        with mysql_manager_sync.session() as db_session:
            row = db_session.execute(
                text("SELECT title FROM agent_session WHERE id = :sid AND is_deleted = 0"),
                {"sid": session_id},
            ).mappings().first()
            if not row:
                logger.warning("精化标题跳过：会话不存在 session_id=%s", session_id)
                return
            current_title = row["title"]
        if not _is_default_title(current_title, user_content):
            logger.info(
                "精化标题跳过：当前标题已被用户手动修改 session_id=%s title=%s",
                session_id, current_title,
            )
            return

        # 2. 调 LLM
        refined = asyncio.run(_arefine(user_content, model_name))
        if not refined:
            logger.warning("精化标题跳过：LLM 返回空 session_id=%s", session_id)
            return

        # 3. 落库（再次双重校验，避免与人工修改竞态覆盖）
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
        # 任何异常都不抛、不重试，保留默认标题
        logger.warning("会话标题精化失败（忽略）：session_id=%s err=%s", session_id, exc)
```

### 3.3 注册 Celery 任务路由

**修改** `backend/app/workers/celery_app.py`：

- `include` 列表追加 `"app.workers.tasks.agent_task"`
- `task_routes` 追加 `"app.workers.tasks.agent_task.*": {"queue": "agent"}`

部署文档同步：worker 启动命令需包含 `-Q eval,agent` 同时消费两个队列。

### 3.4 服务层触发点

**修改** `backend/app/services/agent_runtime_service.py` `_create_user_message`：

```python
# 仅当当前会话没有标题（None / 空 / 默认占位）时才用首条问题作为标题
existing_title = (session.title or "").strip()
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
        # ★ 新增：异步投递 LLM 精化任务（失败不阻塞主流程）
        try:
            from app.workers.tasks.agent_task import refine_session_title_task
            refine_session_title_task.delay(
                session.id, body.content or "", runtime_config.model_name,
            )
            logger.info("已投递会话标题精化任务：session_id=%s", session.id)
        except Exception:
            logger.exception("投递会话标题精化任务失败：session_id=%s", session.id)
```

注意：

- `runtime_config` 需从 `_create_user_message` 调用方透传进来。当前方法签名是
  `(self, session, body, *, run_id)`，需要追加 `runtime_config: LLMRuntimeConfigDTO`
  形参，并在 `stream_message` 调用处传入。
- 任务投递必须用 try/except 包裹：Celery Broker 不可用、序列化失败等场景下，
  默认标题仍然能正常工作，主 SSE 流不能因标题精化失败而中断。

### 3.5 中文输出约束（功能 2）

**修改** `backend/app/llm/prompts/templates/agent/constraints.yaml`，在末尾追加：

```yaml
  ## 输出语言
  - 所有面向用户的输出必须使用简体中文
  - 当输出 JSON 时，所有自然语言字段（advantage、disadvantage、reason、comment、question 等）也必须为简体中文
  - 禁止中英文混杂；专有名词例外（如 React、Python、Vue、SQL 等技术名词原样保留）
```

由于以下模板均已通过 `{% include "agent/constraints.yaml" %}` 引用此约束，**改一处即生效**：

- `evaluation/comprehensive.yaml`
- `evaluation/dimension_eval.yaml`
- `evaluation/skill_match.yaml`
- `interview_questions/dimension_suggest.yaml`
- `interview_questions/question_generate.yaml`
- `interview_questions/question_plan.yaml`
- `resume_evaluation/profile_analyze.yaml`
- `resume_evaluation/visual_report.yaml`

**修改** `backend/app/llm/prompts/templates/agent/system.yaml`：该模板未通过 include 引用，
而是直接内联了「禁止事项 / 确定性要求 / 交互规范」三段。在「交互规范」之后追加同款的
「输出语言」段（与 constraints.yaml 内容一致）。

不动的模板（按原决策）：

- `resume/structure_parse.yaml`：结构化抽取，输出 JSON 字段值取自简历原文，不产生自然语言。
- `admin/*`：管理员侧后台用，不属于用户可见的 Agent 输出链路。

## 四、API 契约影响

**无**。此次改动不新增、不修改任何 HTTP / SSE 接口。

## 五、数据模型影响

**无**。`agent_session.title` 字段（`varchar(80)`）已存在；20 字精化标题完全在容量内。

## 六、缓存影响

**无**。`agent_session` 没有进入 Redis 缓存（会话列表是 DB 实时查询）。

## 七、并发与一致性

| 场景 | 处理 |
| --- | --- |
| 用户首条消息发送中，立即手动改标题 | 任务执行时读 DB 看到新标题 → `_is_default_title` 返回 False → 跳过 |
| Celery Broker 不可用 | 触发点 try/except 兜底，默认标题作为最终结果 |
| LLM 超时 / 限流 / 异常 | 任务内 try/except 全捕获，warn 日志，保留默认标题 |
| LLM 返回空字符串 | 后处理后判空 → 跳过落库 |
| 任务执行期间会话被删除 | `_is_default_title` 第一次查询拿不到记录 → 直接 return |
| 一条消息多次触发（理论不可能） | 第二次执行时 title 已是 LLM 精化态、不属于默认态 → 双重校验跳过 |

## 八、测试策略

### 8.1 单元测试

新增 `backend/tests/workers/test_agent_task.py`：

- `test_make_default_title_consistent_with_runtime_service`：与 `_make_title_from_content` 行为对齐
- `test_is_default_title_recognizes_placeholder`：识别"新会话/未命名会话/空"
- `test_is_default_title_recognizes_truncated_user_content`：识别用户问题截断态
- `test_is_default_title_rejects_user_modified`：用户手动改的标题被识别为非默认
- `test_post_process_strips_punctuation_and_truncates`：去标点+截 20 字
- `test_post_process_handles_empty`：空字符串幂等

### 8.2 集成测试（手动）

1. 启动 Celery worker `-Q eval,agent`
2. 前端新建会话发送一条 30 字以上的问题（如"帮我评估一下张三这份候选人简历，重点看技术能力和项目经验"）
3. 验证：
   - 立即看到默认标题（用户问题截断）
   - 等待 1~5 秒后切换到其他会话再切回，标题应变为 ≤20 字的精化版本
4. 在精化任务执行前手动修改标题为"我自己的标题" → 任务完成后标题应保持"我自己的标题"
5. 故意停掉 Celery worker，验证主 SSE 流不受影响，默认标题仍然落库

### 8.3 中文输出约束验证

1. 用英文向 Agent 提问（如 "summarize this resume"）
2. 验证响应仍为简体中文，不出现英文段落
3. 评估接口 / 面试问题生成接口的 JSON 字段值（advantage/disadvantage/question 等）均为中文

## 九、目录结构合规检查

- `agent_task.py` 放置在 `app/workers/tasks/`，与现有 `eval_task.py` 同级 ✓
- `title_refine.yaml` 放置在 `app/llm/prompts/templates/agent/`，与 `system.yaml/constraints.yaml` 同级 ✓
- 服务层只新增一行 `.delay()` 调用，不破坏 endpoint→service→repository 分层 ✓
- Celery 任务复用 `LLMModelRouter`，遵守 `model_router → gateway → provider client` 分层 ✓

## 十、实施顺序（供 writing-plans 参考）

1. 新增 `agent/title_refine.yaml` 模板
2. 在 `agent/constraints.yaml` 追加「输出语言」段
3. 在 `agent/system.yaml` 追加「输出语言」段
4. 新增 `app/workers/tasks/agent_task.py`（含单元测试）
5. 在 `celery_app.py` 注册任务路由
6. 修改 `agent_runtime_service.py`：方法签名加 `runtime_config`，触发点 `.delay()`
7. 跑测试 + 手动验证 8.2 / 8.3
