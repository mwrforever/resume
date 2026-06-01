# Agent 流式协议 v2

**版本**：`2.0`
**日期**：2026-05-21
**状态**：生效

本规范定义员工 Agent 工作台后端 → 前端的 SSE 流式事件协议。v2 是 v1 的彻底替换版本：删除 legacy 字符串事件、`agent.v1` 双发与 plan_review 相关内容，统一为一份基于 envelope + 事件枚举的协议。

---

## 1. 传输层

- 端点：`POST /api/v1/employee/agent/sessions/{session_id}/messages/stream`、`POST /api/v1/employee/agent/sessions/{session_id}/forms/{request_id}`（form submit 走 JSON RPC，不走 SSE）。
- Content-Type：`text/event-stream`。
- SSE 顶层 event 行恒为 `agent`（错误兜底另用 `error`）。

```
event: agent
data: {"schema_version":"2.0","seq":1,...,"event":"lifecycle.run.started","payload":{...}}

event: agent
data: {"schema_version":"2.0","seq":2,...,"event":"message.delta","payload":{"delta":"你好"}}
```

## 2. 信封 `AgentStreamEnvelope`

| 字段               | 类型                  | 说明                                                    |
| ------------------ | --------------------- | ------------------------------------------------------- |
| `schema_version`   | `"2.0"`               | 固定                                                    |
| `seq`              | `int`                 | 同一 `run_id` 内单调递增，前端按此排序                  |
| `run_id`           | `str`                 | 单条用户消息触发的一次运行 ID                           |
| `session_id`       | `int`                 | `agent_session.id`                                      |
| `node_id`          | `str`                 | 触发节点（coordinator/finalize/...）                    |
| `agent_id`         | `str?`                | 子 Agent（job_agent/...）                               |
| `event`            | `str`                 | 事件类型枚举（见第 3 节）                                |
| `payload`          | `object`              | 事件载荷，结构因 `event` 而异                            |
| `ts`               | `int`                 | 服务器时间戳（毫秒）                                    |
| `extensions`       | `object?`             | 保留扩展字段，前端可安全忽略未知字段                    |

## 3. 事件类型

### 3.1 lifecycle

| `event`                    | 含义                                       | 关键 payload                          |
| -------------------------- | ------------------------------------------ | ------------------------------------- |
| `lifecycle.run.started`    | 一次运行开始                               | `session_key`、`message_id?`          |
| `lifecycle.run.finished`   | 正常结束                                   | `session_key`                         |
| `lifecycle.run.failed`     | 异常结束                                   | `error_code`、`error_message`         |
| `lifecycle.node.enter`     | 节点/子 Agent 进入                         | `node_id`、`agent_id?`                |
| `lifecycle.node.exit`      | 节点/子 Agent 退出                         | `success`、`node_id`                  |
| `lifecycle.node.error`     | 节点错误（仍允许后续节点继续）             | `error_code`、`error_message`         |

### 3.2 message

| `event`            | 含义                | 关键 payload                                        |
| ------------------ | ------------------- | --------------------------------------------------- |
| `message.delta`    | Agent 流式文本增量  | `message_id`、`delta`                               |
| `message.done`     | Agent 文本结束      | `message_id`、`content`、`persisted_message_id?`    |

`message_id` 是前端临时 ID（uuid 字符串），收到 `message.done` 后用 `persisted_message_id` 替换为后端落库 ID。

### 3.3 tool

| `event`            | 含义         | 关键 payload                                                                 |
| ------------------ | ------------ | ---------------------------------------------------------------------------- |
| `tool.started`     | 工具开始执行 | `call_id`、`tool_name`、`display_name`、`input_payload`                      |
| `tool.finished`    | 工具完成     | `call_id`、`success`、`output_payload`、`error_message?`                     |

同一 `call_id` 的 started + finished 在前端聚合为同一 ToolCard，状态 `running → success | failed`。

### 3.4 form

| `event`            | 含义                  | 关键 payload                                          |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `form.requested`   | Agent 请求用户填写表单 | `request_id`、`title`、`prompt`、`fields[]`           |
| `form.resolved`    | 服务端 ACK 表单结果   | `request_id`、`accepted`、`values`                    |

`fields[]` 元素：

```json
{
  "name": "job_id",
  "label": "目标岗位",
  "type": "job_picker",
  "required": true,
  "help_text": "选择要评估的岗位",
  "options": null,
  "default": null
}
```

`type` 支持：`text` / `textarea` / `number` / `select` / `resume_upload` / `job_picker`。

提交 API：`POST /api/v1/employee/agent/sessions/{session_id}/forms/{request_id}`，请求体 `{"values": {...}}`，响应体 `ApiResponse`。提交后服务端继续触发新一轮 stream（独立 run_id）；前端在该 stream 中会收到对应 `form.resolved` 与后续节点事件。

### 3.5 action

| `event`             | 含义                       | 关键 payload                                                                                            |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `action.requested`  | Agent 提案需用户确认的写操作 | `action_id`、`capability_key`、`action_name`、`target_type`、`target_id`、`input_payload`、`preview_payload` |
| `action.resolved`   | 用户已确认 / 拒绝 / 执行结果 | `action_id`、`status ∈ {executed, rejected, failed}`                                                    |

执行 API：`POST /api/v1/employee/agent/actions/execute`，请求体含 `action_id` 与上述确认字段。

### 3.6 data

| `event`                    | 含义                | 关键 payload                              |
| -------------------------- | ------------------- | ----------------------------------------- |
| `data.card`                | 通用结构化卡片      | `card_id`、`card_type`、`title`、`body`   |
| `data.evaluation_report`   | 简历评估报告卡片    | `card_id`、`final_score`、`dimensions[]`  |

### 3.7 error

| `event`  | 含义           | 关键 payload                                              |
| -------- | -------------- | --------------------------------------------------------- |
| `error`  | 统一错误事件   | `code`、`message`、`retriable`                            |

## 4. 时序约束

1. 每次 `stream_message` 必以 `lifecycle.run.started` 开始，以 `lifecycle.run.finished` 或 `lifecycle.run.failed` 结束。
2. `message.delta` 在 `message.done` 之前出现，且共享同一 `message_id`。
3. `tool.started` 必先于同 `call_id` 的 `tool.finished`。
4. `action.requested` 与 `form.requested` 触发后，本次 run 可结束（`lifecycle.run.finished` 紧随其后）；用户决策后由新一次 RPC 触发新的 run。
5. `seq` 在同一 run 内严格递增；前端必须按 `seq` 排序后再渲染。

## 5. 兼容性

- 协议 v1（`agent.v1` 信封 + legacy 字符串事件）已删除。
- 前端遇到未知 `event` 必须安静忽略（forward compatible），不得抛错。
- 后端新增事件必须通过新增枚举值实现，不得复用现有 `event` 字符串。
