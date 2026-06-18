# 简历上传脱离 session + 懒建会话 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简历上传脱离 session_id（只存文件返回路径），解析结果由 checkpoint 管理；点击新建会话立即响应（虚拟会话），首条消息发送时才真正建会话。

**Architecture:** 后端：新上传接口（无 session_id）+ `load_resume` 改按 file_path 解析进 state；前端：虚拟会话（负 id）+ send 时先建会话再发消息。删除旧 session 耦合上传接口与 Redis session_ref。

**Tech Stack:** Python 3.12 / FastAPI / LangGraph（后端）；React 19 / TypeScript / Zustand（前端）。

**对应 Spec:** `docs/superpowers/specs/2026-06-16-resume-upload-lazy-session-design.md`

**约定：**
- 后端测试 `pytest`（`backend/` 下用 `.venv` 的 python：`D:\code\py\project\resume\.venv\Scripts\python.exe -m pytest`）；前端 `npx vitest run`（`frontend/` 下，**须先 `set NODE_ENV=development`**，否则 devDeps 不装）。
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit`（`npx tsc` 会命中伪 tsc 包）。
- 每任务结束 commit；遵循 AGENTS.md（docstring、不吞异常、Redis key 带前缀）。
- 相对路径以仓库根 `D:\code\py\project\resume` 为准。

---

## 文件结构总览

**后端：**
- 修改 `backend/app/api/v1/endpoints/agent.py` — 新上传接口 + 删旧接口
- 修改 `backend/app/services/resume_loader.py` — 新增 `load_by_path`
- 修改 `backend/app/services/agent_runtime_service.py` — `_resolve_resume_ref` 改 file_path + 删 Redis fallback
- 修改 `backend/app/services/interview_question_service.py` + `resume_evaluation_service.py` — `load_resume` 改 file_path
- 删除 `backend/app/services/agent_resume_service.py`（连同 Redis ref 常量）
- 修改 `backend/app/api/v1/deps.py`（或 agent.py 内 DI 工厂）— 移除 AgentResumeService 注入

**前端：**
- 修改 `frontend/src/api/employee/agent.ts` — `uploadResume` 改新接口
- 修改 `frontend/src/components/employee/agent/agent-composer.tsx` — `UploadState` 改 file_path
- 修改 `frontend/src/store/agent.ts` — `createSession` 虚拟会话 + `sendMessage` 先建后发 + `ensureLoaded` 虚拟会话守护
- 修改 `frontend/src/hooks/use-agent-run.ts` — `ensureLoaded` 虚拟会话守护

---

## Task 1: 后端 ResumeLoader 新增 load_by_path

**Files:**
- Modify: `backend/app/services/resume_loader.py`
- Test: `backend/tests/services/test_resume_loader.py`（新建）

**背景：** 现有 `ResumeLoader.load(resume_id)` 走 Redis→DB。新增 `load_by_path(file_path)`：按 file_path 解析文件，无缓存（checkpoint 管理）。复用 `ResumeService._extract_text` 的做法：`storage.get_full_path(file_path)` + `extract_resume_text`。

- [ ] **Step 1: 写失败测试 — load_by_path 解析文件返回文本**

新建 `backend/tests/services/test_resume_loader.py`：

```python
"""ResumeLoader.load_by_path 单测。"""
from unittest.mock import AsyncMock, MagicMock

from app.services.resume_loader import ResumeLoader


def _loader_with_storage(full_path: str, parsed: str):
    """构造 ResumeLoader，storage.get_full_path 返回 full_path，extract_resume_text 返回 parsed。"""
    loader = ResumeLoader.__new__(ResumeLoader)  # 跳过 __init__，避免依赖 repo/cache
    loader._cache = MagicMock()
    loader._repo = MagicMock()
    # 注入 storage（生产由 RuntimeService 注入；此处测试直接挂）
    storage = MagicMock()
    storage.get_full_path = MagicMock(return_value=full_path)
    loader._storage = storage
    return loader, storage


async def test_load_by_path_parses_file(monkeypatch):
    """load_by_path 调 extract_resume_text(full_path) 返回解析文本，不碰 cache/repo。"""
    loader, storage = _loader_with_storage("/data/x.pdf", "解析出的简历文本")
    monkeypatch.setattr(
        "app.services.resume_loader.extract_resume_text",
        lambda path: "解析出的简历文本",
    )
    text = await loader.load_by_path(file_path="x.pdf")
    storage.get_full_path.assert_called_once_with("x.pdf")
    assert text == "解析出的简历文本"


async def test_load_by_path_empty_on_missing_file(monkeypatch):
    """解析返回空串时 load_by_path 返回空串（graph 兜底处理空简历）。"""
    loader, _ = _loader_with_storage("/data/y.pdf", "")
    monkeypatch.setattr("app.services.resume_loader.extract_resume_text", lambda path: "")
    text = await loader.load_by_path(file_path="y.pdf")
    assert text == ""
```

> 说明：`extract_resume_text` 与 `storage` 在生产代码里由 `ResumeLoader` import/持有。测试用 monkeypatch 替换 `app.services.resume_loader.extract_resume_text`，并直接挂 `_storage`。实现（Step 3）须保证 `load_by_path` 内引用的是模块级 import 的 `extract_resume_text`，且构造器接收 `storage`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -m pytest tests/services/test_resume_loader.py -v`
Expected: FAIL（`load_by_path` 未定义）。

- [ ] **Step 3: 实现 load_by_path + 构造器接收 storage**

修改 `backend/app/services/resume_loader.py`：

```python
"""
ResumeLoader：简历原文读取。

- load(resume_id)：旧路径，Redis 缓存 → ResumeRepository（保留供其他调用方）。
- load_by_path(file_path)：新路径，按文件路径解析，无缓存（由 LangGraph checkpoint 管理）。
"""

from __future__ import annotations

import logging

from app.repositories.resume_repository import ResumeRepository
from app.services.cache_service import CacheService
from app.utils.resume_parser import extract_resume_text
from app.utils.storage.registry import StorageRegistry

logger = logging.getLogger(__name__)

CACHE_KEY = "agent:resume_text:{resume_id}"
CACHE_TTL = 1800  # 30 分钟


class ResumeLoader:
    """简历原文读取器。"""

    def __init__(
        self, *,
        cache: CacheService, resume_repo: ResumeRepository, storage: StorageRegistry,
    ) -> None:
        self._cache = cache
        self._repo = resume_repo
        self._storage = storage

    async def load(self, *, resume_id: int) -> str:
        """旧路径：按 resume_id 读取（Redis 缓存 → DB raw_text）。

        Returns:
            简历的纯文本内容。
        Raises:
            LookupError: 简历不存在。
        """
        key = CACHE_KEY.format(resume_id=resume_id)
        cached = await self._cache.get(key)
        if cached:
            logger.debug("简历缓存命中：resume_id=%s", resume_id)
            return cached
        resume = await self._repo.get_by_id(resume_id)
        if resume is None:
            raise LookupError(f"简历不存在：resume_id={resume_id}")
        text = str(getattr(resume, "raw_text", "") or "")
        if text:
            await self._cache.set(key, text, CACHE_TTL)
        return text

    async def load_by_path(self, *, file_path: str) -> str:
        """新路径：按 file_path 解析文件为纯文本，无缓存（checkpoint 管理）。

        Args:
            file_path: 存储层相对路径（如 agent_resumes/{employee_id}/{uuid}.pdf）。
        Returns:
            简历纯文本；文件损坏/空时返回空串（由 graph 兜底处理）。
        """
        full_path = self._storage.get_full_path(file_path)
        return extract_resume_text(full_path)
```

> 注意：构造器新增 `storage: StorageRegistry` 形参。所有 `ResumeLoader(...)` 实例化处（DI 工厂）须补传 storage——见 Task 5 清理。本任务先让测试过。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -m pytest tests/services/test_resume_loader.py -v`
Expected: 2 PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/resume_loader.py backend/tests/services/test_resume_loader.py
git commit -m "feat(loader): ResumeLoader 新增 load_by_path（按 file_path 解析，无缓存）"
```

---

## Task 2: 后端 _resolve_resume_ref 改 file_path + 删 Redis fallback

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py:335-360`
- Test: `backend/tests/services/test_resolve_resume_ref.py`（新建）

**背景：** `_resolve_resume_ref` 现在两层：context_refs(resume_id) → Redis session_ref。改为：context_refs 取 `{type:'resume', file_path, file_name}`（file_path 必填），**删除 Redis fallback**。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/services/test_resolve_resume_ref.py`：

```python
"""_resolve_resume_ref 单测：context_refs 取 file_path，无 Redis fallback。"""
import pytest

from app.core.exceptions import ValidationError


def _make_service():
    """构造 AgentRuntimeService 跳过 __init__（仅测纯函数 _resolve_resume_ref）。"""
    from app.services.agent_runtime_service import AgentRuntimeService
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._agent_resume = None  # 不再使用
    return svc


def _body(context_refs):
    from app.schemas.agent.request import AgentMessageCreate
    return AgentMessageCreate(content="hi", context_refs=context_refs)


async def test_resolve_returns_file_path_from_context_refs():
    svc = _make_service()
    body = _body([{"type": "resume", "file_path": "a/b.pdf", "file_name": "x.pdf"}])
    ref = await svc._resolve_resume_ref(session_id=1, body=body)
    assert ref == {"file_path": "a/b.pdf", "file_name": "x.pdf"}


async def test_resolve_missing_file_path_raises():
    svc = _make_service()
    body = _body([{"type": "resume", "file_name": "x.pdf"}])  # 无 file_path
    with pytest.raises(ValidationError):
        await svc._resolve_resume_ref(session_id=1, body=body)


async def test_resolve_no_resume_ref_returns_none():
    """无简历引用返回 None（无 Redis fallback）。"""
    svc = _make_service()
    body = _body([])
    ref = await svc._resolve_resume_ref(session_id=1, body=body)
    assert ref is None
```

> 先读 `AgentMessageCreate`（`backend/app/schemas/agent/request.py`）确认必填字段，对齐 `_body` helper（可能还有 workflow_type 等）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -m pytest tests/services/test_resolve_resume_ref.py -v`
Expected: FAIL（当前要 resume_id，且会调 Redis）。

- [ ] **Step 3: 改 _resolve_resume_ref**

`agent_runtime_service.py` 的 `_resolve_resume_ref`（约 335-360 行）改为：

```python
    async def _resolve_resume_ref(
        self, session_id: int, body: AgentMessageCreate,
    ) -> dict[str, Any] | None:
        """解析简历引用：仅从本轮 context_refs 取 file_path。

        遵循"agent_message 内容仅供展示"原则：不从历史消息推导，也不再用 Redis
        会话引用（懒建会话后无意义）。不命中返回 None，由工作流兜底处理空简历
        （图二 _route_after_profile 对空简历短路 END，图一 load_resume 也能处理空文本）。
        """
        for ref in body.context_refs or []:
            if str(ref.get("type") or "").lower() == "resume":
                file_path = str(ref.get("file_path") or "").strip()
                if not file_path:
                    raise ValidationError("简历附件缺少 file_path")
                return {
                    "file_path": file_path,
                    "file_name": str(ref.get("file_name") or ""),
                }
        return None
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -m pytest tests/services/test_resolve_resume_ref.py -v`
Expected: 3 PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_resolve_resume_ref.py
git commit -m "refactor(runtime): _resolve_resume_ref 改用 file_path，删除 Redis session_ref fallback"
```

---

## Task 3: 后端两个 service 的 load_resume 改 file_path

**Files:**
- Modify: `backend/app/services/interview_question_service.py:60-73`
- Modify: `backend/app/services/resume_evaluation_service.py:103-116`

**背景：** 两个 `load_resume` 现在读 `resume_ref.resume_id` 调 `loader.load(resume_id=...)`。改为读 `resume_ref.file_path` 调 `loader.load_by_path(file_path=...)`。emit 的 tool_use block input 也改为 file_path。

- [ ] **Step 1: 改 InterviewQuestionService.load_resume**

`interview_question_service.py:60-73`：

```python
    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """按 file_path 解析简历原文，emit tool_use block。解析结果进 state.resume_text，
        同 task 内由 checkpoint 复用（无 Redis 缓存）。"""
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        file_path = str((state.get("resume_ref") or {}).get("file_path") or "")
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"file_path": file_path}, "status": "running",
        }))
        try:
            text = await self._loader.load_by_path(file_path=file_path) if file_path else ""
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text}
```

- [ ] **Step 2: 改 ResumeEvaluationService.load_resume**

`resume_evaluation_service.py:103-116`：同上改法（file_path + load_by_path + 空守卫）。

- [ ] **Step 3: 验证 import 干净**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -c "from app.services.interview_question_service import InterviewQuestionService; from app.services.resume_evaluation_service import ResumeEvaluationService; print('IMPORT_OK')"`
Expected: IMPORT_OK。

- [ ] **Step 4: 提交**

```bash
git add backend/app/services/interview_question_service.py backend/app/services/resume_evaluation_service.py
git commit -m "refactor(workflow): load_resume 改按 file_path 解析（checkpoint 管理 resume_text）"
```

---

## Task 4: 后端新上传接口 + 删旧接口 + 删 AgentResumeService

**Files:**
- Modify: `backend/app/api/v1/endpoints/agent.py:338-355`
- Modify: `backend/app/api/v1/deps.py`（DI 工厂，移除 AgentResumeService）
- Delete: `backend/app/services/agent_resume_service.py`

**背景：** 新接口 `POST /employee/agent/resumes`（无 session_id）：存文件（employee 隔离目录）→ 返回 `{file_path, file_name}`。删除旧 `POST /sessions/{id}/resumes` 与 `AgentResumeService`。

- [ ] **Step 1: 新增新上传接口**

`agent.py`，在原简历上传区（338-355 行）替换为：

```python
# ============================= 简历上传 =============================


@agent_router.post("/resumes")
async def upload_resume(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    storage: StorageRegistry = Depends(_get_storage),
):
    """上传简历文件（脱离 session）。

    只存盘返回 file_path/file_name，不解析、不入 resume 表、不写 Redis。
    解析在首条消息的 load_resume 节点按 file_path 进行，结果由 checkpoint 管理。
    """
    employee_id = int(current_user.get("employee_id") or 0)
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    relative_path = f"agent_resumes/{employee_id}/{uuid.uuid4().hex}{ext}"
    file_path = await storage.upload(file, relative_path=relative_path)
    return ApiResponse(data={"file_path": file_path, "file_name": str(file.filename or "")})
```

> import 顶部补 `import os`、`import uuid`、`from app.utils.storage.registry import StorageRegistry`、`_get_storage` 依赖（见 Step 2）。`current_user` 取 employee_id 的字段名以项目 auth 实际为准（先读 `get_current_user` 返回结构对齐）。

- [ ] **Step 2: 补 storage DI 工厂**

在 `deps.py`（或 agent.py 的 DI 区）加：

```python
def _get_storage() -> StorageRegistry:
    """获取存储层单例。"""
    from app.utils.storage.registry import get_storage_registry
    return get_storage_registry()
```

> 若项目已有 storage 单例获取函数（查 `app/utils/storage/registry.py`），直接复用其名；否则按上添加。先读该文件确认 `StorageRegistry` 与获取函数的真实导出名。

- [ ] **Step 3: 删除旧接口 + AgentResumeService**

- 删除 `backend/app/services/agent_resume_service.py`。
- agent.py 删除旧 `upload_resume`（session 版）的 import 与 DI（`_get_resume_service`、`AgentResumeService`）。
- deps.py 移除 `_get_resume_service` 工厂（若无其他引用）。
- 全局搜索 `AgentResumeService`、`SESSION_RESUME_REF_KEY`、`get_session_ref` 残留引用并清理。

```bash
# 在 backend 下检查残留
grep -rn "AgentResumeService\|SESSION_RESUME_REF\|get_session_ref" app/
```
> 预期：除注释/已删文件外无引用。`agent_runtime_service.py` 的 `_resolve_resume_ref` 已在 Task 2 删除 Redis 调用；构造器若注入了 `_agent_resume` 字段，一并移除（见 Task 5）。

- [ ] **Step 4: 验证后端启动**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -c "from app.main import app; print('APP_OK', [r.path for r in app.routes if 'resume' in str(r.path)])"`
Expected: 列出 `/api/v1/employee/agent/resumes`，无 `/sessions/{session_id}/resumes`。

- [ ] **Step 5: 提交**

```bash
git rm backend/app/services/agent_resume_service.py
git add backend/app/api/v1/endpoints/agent.py backend/app/api/v1/deps.py
git commit -m "feat(api): 新增 POST /resumes 上传接口（脱离 session）+ 删除旧 session 耦合上传与 Redis ref"
```

---

## Task 5: 后端 DI 清理 + ResumeLoader 注入 storage

**Files:**
- Modify: `backend/app/api/v1/deps.py` 或 `backend/app/main.py`（ResumeLoader 实例化处）
- Modify: `backend/app/services/agent_runtime_service.py`（若持有 `_agent_resume` 字段）

**背景：** Task 1 给 `ResumeLoader` 构造器加了 `storage` 形参；Task 4 删了 `AgentResumeService`。需把所有 `ResumeLoader(...)` 实例化处补 `storage=...`，并移除 `AgentRuntimeService` 对 `_agent_resume` 的注入。

- [ ] **Step 1: 找 ResumeLoader 实例化处并补 storage**

```bash
cd backend && grep -rn "ResumeLoader(" app/
```
> 每个 `ResumeLoader(cache=..., resume_repo=...)` 补 `storage=<storage 单例>`。

- [ ] **Step 2: 移除 AgentRuntimeService 的 _agent_resume**

`agent_runtime_service.py` 构造器若有 `agent_resume: AgentResumeService` 形参与 `self._agent_resume = agent_resume`，删除；实例化处（deps/main）也移除该实参。`_resolve_resume_ref` 已不用它（Task 2）。

- [ ] **Step 3: 验证后端启动**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -c "from app.main import app; from app.services.resume_loader import ResumeLoader; print('OK')"`
Expected: OK（无 import/实例化错误）。

- [ ] **Step 4: 回归后端测试**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -m pytest tests/llm/ tests/services/test_resume_loader.py tests/services/test_resolve_resume_ref.py tests/services/test_resume_evaluation_dim_name.py tests/schemas/ -v`
Expected: 全 PASS（确认 Task 1-4 改动未破坏既有测试）。

- [ ] **Step 5: 提交**

```bash
git add backend/app/api/v1/deps.py backend/app/main.py backend/app/services/agent_runtime_service.py
git commit -m "refactor(di): ResumeLoader 注入 storage + 移除 AgentRuntimeService 的 AgentResumeService 依赖"
```

---

## Task 6: 前端 uploadResume API 改新接口

**Files:**
- Modify: `frontend/src/api/employee/agent.ts:109-117`

**背景：** `uploadResume(sessionId, file)` 改为 `uploadResume(file)`，调 `POST /employee/agent/resumes`，返回 `{file_path, file_name}`。

- [ ] **Step 1: 改 API 函数**

`api/employee/agent.ts`（109-117 行）：

```typescript
  /** 上传简历（脱离 session，只存文件返回路径） */
  uploadResume: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/employee/agent/resumes', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
```

- [ ] **Step 2: tsc 验证（会有 composer 调用处报错，预期）**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: `agent-composer.tsx` 处 `uploadResume(session.id, file)` 报参数不匹配错误（Task 7 修复）。

- [ ] **Step 3: 提交（API 层先就位）**

```bash
git add frontend/src/api/employee/agent.ts
git commit -m "refactor(api): uploadResume 改调 POST /resumes（无 session_id）"
```

---

## Task 7: 前端 composer UploadState 改 file_path

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx:35-39,96-115,73-81`

**背景：** `UploadState.success` 从 `{resumeId, fileName, size}` 改为 `{file_path, fileName}`；`onPickFile` 调新 `uploadResume(file)`；`submit()` 的 context_refs 带 file_path。

- [ ] **Step 1: 改 UploadState 类型 + onPickFile**

`agent-composer.tsx`：

类型（35-39 行）：
```typescript
type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string }
  | { kind: 'success'; file_path: string; fileName: string }
  | { kind: 'error'; message: string };
```

`onPickFile`（96-115 行）：
```typescript
  const onPickFile = async (file: File) => {
    setUpload({ kind: 'uploading', fileName: file.name });
    try {
      const resp = await employeeAgentApi.uploadResume(file);
      const data = resp.data?.data ?? resp.data;
      if (data?.file_path) {
        setUpload({
          kind: 'success',
          file_path: data.file_path,
          fileName: data.file_name ?? file.name,
        });
      } else {
        setUpload({ kind: 'error', message: '上传失败：响应缺少 file_path' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败';
      setUpload({ kind: 'error', message: msg });
    }
  };
```

- [ ] **Step 2: 改 submit() 的 context_refs**

`submit()`（73-81 行）：
```typescript
  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    const ctxRefs = upload.kind === 'success'
      ? [{ type: 'resume', file_path: upload.file_path, file_name: upload.fileName }]
      : undefined;
    onSend({ content: trimmed, workflow_type: workflow, context_refs: ctxRefs });
    setContent('');
    setUpload({ kind: 'idle' });
  };
```

- [ ] **Step 3: 改 UploadChip success 分支（去 size）**

`UploadChip` 的 success 分支（约 254-266 行）移除 `state.size` 相关（API 不再返回 size），其余（ResumeFileIcon + fileName + X）保留：
```typescript
  if (state.kind === 'success') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                      bg-[#E0F2FE] text-[#0369A1] text-xs font-medium border border-[#0EA5E9]/20">
        <ResumeFileIcon fileName={state.fileName} size={16} />
        <span className="truncate max-w-[260px]">已附上 · {state.fileName}</span>
        <button type="button" onClick={onClear}
                className="ml-1 hover:text-[#DC2626] transition-colors" title="移除附件">
          <X size={12} />
        </button>
      </div>
    );
  }
```

- [ ] **Step 4: tsc 验证**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/agent-composer.tsx
git commit -m "refactor(composer): UploadState 改 file_path，context_refs 带 file_path/file_name"
```

---

## Task 8: 前端虚拟会话（createSession 本地生成）

**Files:**
- Modify: `frontend/src/store/agent.ts`（createSession + creating flag 语义调整）
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`（按钮去 loading）

**背景：** `createSession` 不再调后端，改为本地生成虚拟会话（负 id）。点新建立即响应。`creating` flag 仍用于防重入（避免连点生成多个虚拟会话），但同步置位/复位（不发请求）。

- [ ] **Step 1: 改 createSession 为虚拟会话**

`store/agent.ts` `createSession`（约 134-142 行）：

```typescript
  createSession: async () => {
    // 重入守护：创建中再点击直接返回
    if (get().creating) return;
    // 生成虚拟会话：负数临时 id，首条消息发送时才真正建会话（sendMessage 内处理）
    const virtualSession: WorkspaceSession = {
      id: -Date.now(),
      session_key: '',
      current_task_id: '',
      employee_id: 0,
      title: null,
      selected_model_name: null,
      enable_thinking: false,
      status: 0,
      last_message_time: null,
      create_time: null,
      update_time: null,
    };
    set((s) => ({
      sessions: [virtualSession, ...s.sessions.filter(x => x.id >= 0 || x.id === virtualSession.id)],
      // 丢弃其它未发送的虚拟会话，只保留最新一个
      activeId: virtualSession.id,
      runs: {
        ...s.runs,
        [virtualSession.id]: {
          session: virtualSession, messages: [], runState: INITIAL_RUN_STATE,
          sending: false, loaded: true,  // 虚拟会话标记 loaded，避免 ensureLoaded 调后端
        },
      },
    }));
  },
```

> `INITIAL_RUN_STATE` 须从 `@/utils/agent-run-reducer` import（store 内若未 import 则补）。`runs[id].loaded=true` 关键——防止 `ensureLoaded` 对负 id 调后端。

- [ ] **Step 2: ensureLoaded 守护负 id（双保险）**

`store/agent.ts` `ensureLoaded`（约 118 行）开头加：
```typescript
  ensureLoaded: async (id) => {
    if (id < 0) return;  // 虚拟会话不入库，不调后端
    if (get().runs[id]?.loaded) return;
    // ...原有逻辑
  },
```

- [ ] **Step 3: useAgentRun ensureLoaded 守护（同源）**

`hooks/use-agent-run.ts`（55-57 行）：
```typescript
  useEffect(() => {
    if (sessionId >= 0) void ensureLoaded(sessionId);
  }, [sessionId, ensureLoaded]);
```

- [ ] **Step 4: 侧栏按钮去 loading（虚拟会话瞬时）**

`agent-sidebar-drawer.tsx`：两处新建按钮（展开态 + FAB）去掉 `creating` 时的 `Loader2`/`disabled`/`创建中…`（虚拟会话本地瞬时完成）。可保留 `creating` 订阅但 UI 不依赖它（或直接移除 `creating` 订阅与按钮 disabled 逻辑）。**注意**：保留防重入（store 内 `creating` flag 守护）——但 `creating` 现在在 createSession 内同步置位复位，按钮 disabled 会一闪而过，建议**移除按钮的 creating 绑定**，仅靠 store 重入守护。

展开态按钮改回：
```tsx
          <button
            type="button"
            onClick={() => onCreate()}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-lg
                       bg-[#0369A1] text-white text-sm font-medium
                       hover:bg-[#0EA5E9] transition-colors duration-150"
          >
            <Plus size={16} />
            <span>新建会话</span>
          </button>
```
FAB 同理改回（去 disabled/Loader2）。

> 同时移除文件顶部的 `creating` 订阅（`useAgentStore((s) => s.creating)`）若不再使用。

- [ ] **Step 5: tsc + 手动验证**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
手动：`npm run dev` → 点新建会话 → 立即出现空输入区（无 loading）；连点不会出现多个（防重入）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/store/agent.ts frontend/src/hooks/use-agent-run.ts frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx
git commit -m "feat(agent-fe): 新建会话改虚拟会话（本地瞬时生成），首条消息发送时才建会话"
```

---

## Task 9: 前端 sendMessage 虚拟会话先建后发 + 失败回滚

**Files:**
- Modify: `frontend/src/store/agent.ts`（sendMessage）

**背景：** `sendMessage(sessionId, input)` 检测 `sessionId < 0`（虚拟会话）：先调后端建会话拿真实 id → 替换虚拟会话（保留乐观消息与 file_path）→ 再 streamMessage(realId)。失败则移除虚拟会话 + 提示。

- [ ] **Step 1: 改 sendMessage 加建会话时序**

`store/agent.ts` `sendMessage`（约 171-218 行），在乐观追加消息之前加建会话分支：

```typescript
  sendMessage: async (sessionId, input) => {
    // 虚拟会话（负 id）：先真正建会话，再发消息
    let realSessionId = sessionId;
    let virtualId: number | null = null;
    if (sessionId < 0) {
      virtualId = sessionId;
      set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));
      try {
        const resp = await employeeAgentApi.createSession({ title: undefined });
        const newSession = (resp.data?.data ?? resp.data) as WorkspaceSession;
        realSessionId = newSession.id;
        // 用真实会话替换虚拟会话：迁移 runs（保留已上传状态由调用方持有）、sessions、activeId
        set((s) => {
          const prevRun = s.runs[virtualId!];
          const runs = { ...s.runs };
          delete runs[virtualId!];
          runs[newSession.id] = {
            ...(prevRun ?? { messages: [], runState: INITIAL_RUN_STATE }),
            session: newSession, sending: true,
          };
          return {
            runs,
            sessions: [newSession, ...s.sessions.filter(x => x.id !== virtualId)],
            activeId: newSession.id,
          };
        });
      } catch (err) {
        // 建会话失败：移除虚拟会话 + 提示
        set((s) => {
          const runs = { ...s.runs };
          delete runs[virtualId!];
          return {
            runs,
            sessions: s.sessions.filter(x => x.id !== virtualId),
            activeId: s.sessions.find(x => x.id !== virtualId && x.id >= 0)?.id ?? null,
            creating: false,
          };
        });
        console.error('建会话失败', err);
        return;  // 中止发送
      }
    }

    const ac = new AbortController();
    abortControllers.set(realSessionId, ac);
    set((s) => ({ runs: { ...s.runs, [realSessionId]: { ...getRun(s.runs, realSessionId), sending: true } } }));

    // 乐观追加用户消息（用 realSessionId，负数临时 id，reload 后替换）
    const optimisticUserMessage: AgentMessage = {
      id: -Date.now(),
      session_id: realSessionId,
      parent_message_id: null,
      role: 'user',
      workflow_type: input.workflow_type,
      run_id: null,
      content: {
        blocks: [{ type: 'text', index: 0, text: input.content, status: 'success' }],
        context_refs: input.context_refs,
      },
      model_name: null,
      token_count: null,
      sort_order: 0,
      create_time: new Date().toISOString(),
    };
    // ... 标题乐观更新 + set + streamMessage(realSessionId, ...) 部分保持原逻辑，
    // 仅把原 sessionId 全部替换为 realSessionId（abortControllers、set runs key、streamMessage 调用）。
```

> 关键替换点：原 `sendMessage` 内所有用 `sessionId` 的地方（`abortControllers.set(sessionId,...)`、`getRun(s.runs, sessionId)`、`streamMessage(sessionId,...)`、finally 里 `abortControllers.delete`）全部改用 `realSessionId`。`finally` 的 `sending:false` 也针对 `realSessionId`。

- [ ] **Step 2: tsc 验证**

Run: `cd frontend && node node_modules/typescript/bin/tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 手动端到端验证**

`npm run dev`：
1. 点新建会话 → 立即空输入区。
2. （可选）上传简历 → composer 显示图标。
3. 发消息 → 建会话（短暂网络往返）→ 消息进入会话、简历图标显示、Agent 开始回复。
4. 验证：侧栏出现真实会话项（非负 id）；切到其它会话再回来正常。
5. 失败场景（断网）→ 虚拟会话消失 + 不产生半成品。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/store/agent.ts
git commit -m "feat(agent-fe): sendMessage 虚拟会话先建后发 + 失败回滚"
```

---

## Task 10: 端到端回归 + 清理

**Files:**
- 全局检查残留

**背景：** 确认全链路通，清理未用代码/测试。

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && "D:\code\py\project\resume\.venv\Scripts\python.exe" -m pytest tests/ -v`
Expected: 全 PASS（含 Task 1-2 新测试，及既有 gateway/dim_name/dto 测试）。

- [ ] **Step 2: 前端全量测试 + tsc**

Run: `cd frontend && set NODE_ENV=development && npx vitest run src/components/employee/agent && node node_modules/typescript/bin/tsc --noEmit`
Expected: 测试全 PASS，tsc 无错误。

- [ ] **Step 3: 残留搜索**

```bash
cd backend && grep -rn "AgentResumeService\|SESSION_RESUME_REF\|get_session_ref\|resume_id.*context_refs\|_agent_resume" app/
cd ../frontend && grep -rn "uploadResume(.*session\|resumeId.*UploadState\|\.resumeId" src/
```
> 预期无业务引用残留（注释可保留）。清理发现的死代码。

- [ ] **Step 4: 最终提交（若有清理）**

```bash
git add -A
git commit -m "chore: 清理简历上传重构残留"
```

---

## 自检（写完后核对）

**1. Spec 覆盖：**
- 上传脱离 session（接口只存文件返回 file_path）→ Task 4 ✓
- 不入表/不解析/不缓存 → Task 4 ✓
- load_resume 按 file_path 解析进 state，checkpoint 管理 → Task 1（loader）+ Task 3（service）✓
- 删 Redis session_ref + AgentResumeService → Task 2（fallback）+ Task 4（删 service）✓
- DI 清理（loader 注入 storage、runtime 去 _agent_resume）→ Task 5 ✓
- 虚拟会话 → Task 8 ✓
- send 先建后发 + 回滚 → Task 9 ✓
- composer file_path → Task 7 ✓
- API uploadResume 改新接口 → Task 6 ✓
- 验收 8 条全部对应（点新建立即响应/连点/虚拟期上传/先建后发/接口无 session/删旧/解析进 state/驳回不重跑 load_resume）✓

**2. 占位符扫描：** 无 TBD；每步含完整代码。Task 4 的 `current_user` employee_id 字段名、`StorageRegistry` 获取函数名标了"以实际为准/先读确认"，是必要的现场核对而非占位。

**3. 类型一致性：**
- `load_by_path(file_path)` 在 Task 1 定义、Task 3 调用，签名一致 ✓
- `UploadState.success.file_path` 在 Task 7 定义、Task 9 未直接用（composer 持有）✓
- `_resolve_resume_ref` 返回 `{file_path, file_name}`（Task 2），Task 3 的 load_resume 读 `resume_ref.file_path` ✓
- `realSessionId` 在 Task 9 内部一致替换 ✓
