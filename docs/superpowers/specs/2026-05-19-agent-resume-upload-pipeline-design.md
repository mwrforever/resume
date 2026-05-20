# Agent 会话简历上传与编排串联设计

**日期**：2026-05-19  
**状态**：待评审  
**范围**：员工端 Agent 工作台 — 简历上传 → 结构化解析 → 评估 Agent → 分析 Agent → 既有 Planner 审批流

---

## 1. 背景与问题

### 1.1 现状

| 能力 | 状态 |
|------|------|
| 用户端简历上传（PDF/DOCX + `extract_resume_text`） | 已有 `ResumeService` |
| 岗位维度 AI 评估（`ResumeEvalChain`） | 已有，用于投递评估 Celery 任务 |
| Agent 编排图 Analyst → Planner(interrupt) → Supervisor → LegacyExecutor → Reporter | 部分节点存在，**图边不完整** |
| 前端 Agent 发消息 | 仅文本，`context_refs: []` |
| Analyst 节点 | 仅判断 `user_input` 非空，未消费简历/评估结果 |

### 1.2 用户目标

1. Agent 会话支持上传简历文件  
2. 大模型将简历解析为 **Markdown 结构化内容**（非仅 raw_text）  
3. **评估 Agent** 产出结构化评估结果  
4. **分析 Agent（Analyst）** 综合用户问题 + 简历结构 + 评估结论，再进入 Planner  
5. **整条 LangGraph 可结束**：无悬空节点、无无法到达 `END` 的分支  

---

## 2. 目标链路（推荐）

```text
[可选] resume_ingest     校验附件、落库、抽取原始文本
        ↓
        resume_parser      LLM → 结构化 Markdown（章节化）
        ↓
        resume_evaluator   评估 Agent（复用 ResumeEvalChain 逻辑，需岗位）
        ↓
        analyst              写入 analysis_summary，决定 analysis_ready
        ↓
        planner              interrupt 审批（已有 PlanReviewTree 前端）
        ↓
        supervisor
        ↓
        legacy_executor      工具 + LLM 生成 final_content
        ↓
        reporter             整理输出（可透传 final_content）
        ↓
        END
```

**无简历附件时**：`set_conditional_entry` 直接进入 `analyst`（与现网行为兼容）。

---

## 3. 编排图修复（解决「孤立、无法结束」）

### 3.1 必须补全的边与出口

在 `orchestrator_graph.py` 中显式注册（LangGraph `Command(goto=...)` 仍建议配合边，便于静态理解与测试）：

| 来源 | 目标 | 说明 |
|------|------|------|
| `resume_ingest` | `resume_parser` | 有附件 |
| `resume_parser` | `resume_evaluator` | 解析成功 |
| `resume_parser` | `reporter` | 解析失败（带 error_message） |
| `resume_evaluator` | `analyst` | 评估完成 |
| `resume_evaluator` | `reporter` | 缺岗位/评估失败 |
| `analyst` | `planner` / `reporter` | 已有条件边 |
| `planner` | `planner` / `supervisor` / `reporter` | Command 内循环 / 批准 / 超限 |
| `supervisor` | `legacy_executor` | **当前缺失** |
| `legacy_executor` | `reporter` | 已有 |
| `reporter` | `END` | 已有 |

### 3.2 统一失败出口

所有失败分支 `goto=AgentNodeId.REPORTER`，由 `reporter_node` 生成用户可读说明并写入 `final_content`，保证 **每条路径最终到达 END**。

Planner 修订超限、解析失败、评估失败均走此模式。

---

## 4. State 扩展（强类型）

在 `OrchestratorState` 增加：

```python
class ResumeContextDTO(BaseModel):
    resume_id: int | None = None
    file_name: str = ""
    raw_text: str = ""
    structured_markdown: str = ""      # LLM 解析结果
    job_id: int | None = None          # 评估绑定岗位

class ResumeEvaluationDTO(BaseModel):
    job_id: int
    job_name: str = ""
    final_score: float | None = None
    final_label: str = ""
    advantage_comment: str = ""
    disadvantage_comment: str = ""
    dimensions: list[dict] = []        # 与 ResumeEvalChain 对齐
    skill_hits: list[dict] = []
    summary_markdown: str = ""         # 给 Analyst/Planner 阅读的摘要

# OrchestratorState 新增字段
resume_context: ResumeContextDTO | None = None
resume_evaluation: ResumeEvaluationDTO | None = None
has_resume_attachment: bool = False
```

`AgentMessageCreate.context_refs` 约定（单条）：

```json
{
  "type": "resume",
  "resume_id": 123,
  "job_id": 456
}
```

或先发附件 API 再发消息只传 `resume_id` + `job_id`。

---

## 5. 后端 API

### 5.1 简历附件（推荐两步，利于大文件与重试）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/employee/agent/sessions/{session_id}/attachments/resume` | `multipart/form-data`: `file`, 可选 `job_id` |
| POST | `/api/v1/employee/agent/sessions/{id}/messages/stream` | body 含 `context_refs: [{ type, resume_id, job_id }]` |

上传接口：复用 `ResumeService` 存储 + `extract_resume_text`，返回 `resume_id`、`file_name`（**不在此步调 LLM**，避免 HTTP 超时）。

解析与评估在 **编排图节点** 内执行，通过 SSE `agent.v1` 推送进度（`lifecycle.node_enter/exit`、`ui.render` 可选 `ResumeParseProgress`）。

### 5.2 新增 LLM Prompt

`backend/app/llm/prompts/templates/resume_structure_parse.yaml`  
输出固定 Markdown 模板，例如：基本信息 / 教育 / 工作 / 项目 / 技能 等章节，禁止编造。

评估节点：直接调用现有 `ResumeEvalChain`，输入 `structured_markdown` 或 `raw_text`（优先结构化内容）。

---

## 6. 节点职责

| 节点 | 职责 |
|------|------|
| `resume_ingest` | 从 `context_refs` 加载简历记录，填充 `resume_context.raw_text` |
| `resume_parser` | LLM → `structured_markdown`，SSE 事件 `resume.parse_done` |
| `resume_evaluator` | 校验 `job_id`，跑评估链，写 `resume_evaluation` |
| `analyst` | 合并 `user_input` + 简历结构 + 评估摘要 → `analysis_summary`；无岗位时 `analysis_ready=false` 并提示选岗位 |
| 其余 | 保持现有 Planner interrupt / Supervisor / Executor / Reporter |

---

## 7. 前端（员工 Agent 工作台）

1. **AgentComposer**：增加简历上传按钮（PDF/DOCX），展示已选文件与岗位选择（下拉，数据源 `employee` 岗位列表 API）。  
2. 发消息时：`context_refs` 携带 `{ type: 'resume', resume_id, job_id }`。  
3. SSE：解析/评估阶段在 `runtimeFeedItems` 展示「简历解析中」「简历评估中」（监听 `agent.v1` 节点生命周期）。  
4. 有 `planReview` 待审批时逻辑不变；**有简历且无 job_id 时禁用发送**（或上传区强制选岗位）。

接口走 `src/api/employee/agent.ts`：`uploadResumeAttachment(sessionId, file, jobId)`。

---

## 8. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 全 LangGraph 节点（推荐）** | 可观测、可扩展、与 Planner 一致 | 改动面较大 |
| B. Service 层预处理后进图 | 实现快 | 评估/解析非 Agent 节点，难单独追踪 |
| C. Celery 异步评估 + 轮询 | 适合超大简历 | 与会话 SSE 体验割裂，复杂度高 |

**推荐 A**：满足「评估 Agent + 分析 Agent + 整条串起来」且便于修复图出口。

---

## 9. 验收标准

1. 上传 PDF/DOCX 后，SSE 可见解析 → 评估 → 分析 →（可选）规划审批 → 最终回复。  
2. Checkpoint 中可读到 `structured_markdown` 与 `resume_evaluation`。  
3. 无附件会话行为与现网一致（直达 Analyst）。  
4. 解析失败 / 无岗位 / 规划驳回超限 均能结束会话，不卡在 interrupt 且无 final。  
5. 后端集成测试：有简历全链路 + 无简历冒烟 + 失败分支各一。  

---

## 10. 实施分期（获批后）

| 阶段 | 内容 |
|------|------|
| P0 | 图边修复 + State/DTO + 三节点 + Analyst 增强 |
| P1 | 上传 API + Service 注入 context_refs |
| P2 | 前端上传/岗位选择 + SSE 进度展示 |
| P3 | 可选 UI：`ResumeEvalSummary` 组件展示评估卡片 |

---

## 11. 待确认问题

**评估简历是否必须绑定岗位？**  
- 选项 1：上传前/发消息前 **必选岗位**（推荐，与 `ResumeEvalChain` 一致）  
- 选项 2：允许仅解析不评估，用户追问时再选岗位触发评估  

请确认后进入 `writing-plans` 与实现。
