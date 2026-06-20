/**
 * Agent 工作台全局状态（多会话并发）。
 *
 * 单一数据源：sessions 列表 + activeId + 每会话运行态 runs[id]。
 * 流式逻辑从 use-agent-run hook 迁移至此：store action 是模块级 promise，
 * 与组件生命周期解耦 → 切换会话不会中止非活跃会话的流，实现真后台并发。
 *
 * 约束：每会话同一时刻只有一个活跃 run（护后端，避免 LangGraph 同 thread 并发）。
 * 同会话 sending 期间发送/提交按钮由 UI 禁用，store action 内不再二次拦截。
 *
 * AbortController 不进 React state（不可序列化、不应触发重渲染），放模块级 Map。
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { employeeAgentApi } from '@/api/employee/agent';
import { INITIAL_RUN_STATE, agentRunReducer } from '@/utils/agent-run-reducer';
import { isDefaultTitle, makeTitleFromContent } from '@/utils/title';
import type {
  AgentEnvelope, AgentMessage, AgentRunState, WorkflowType, WorkspaceSession,
} from '@/types/agent';

/** 单会话运行态 */
interface RunEntry {
  /** 会话详情（GET /sessions/{id} 返回的 session 字段） */
  session: WorkspaceSession | null;
  /** 已落库的历史消息 */
  messages: AgentMessage[];
  /** 流式正在构造的实时状态（reducer 管理） */
  runState: AgentRunState;
  /** 是否正在发送/提交（流式 run 进行中） */
  sending: boolean;
  /** 会话详情是否已拉取过（避免重复 GET） */
  loaded: boolean;
}

/** 发送消息入参（与原 useAgentRun.SendInput 对齐） */
export interface SendInput {
  content: string;
  workflow_type: WorkflowType;
  enable_thinking?: boolean;
  model_name?: string | null;
  context_refs?: Array<Record<string, unknown>>;
}

interface AgentStoreState {
  sessions: WorkspaceSession[];
  activeId: number | null;
  runs: Record<number, RunEntry>;
  /** 正在创建新会话（重入守护 + 侧栏按钮 loading/disabled） */
  creating: boolean;
  /** 思考模式全局默认值（仅作新建会话的初始值，localStorage 持久化）。
   * 切换它只影响之后新建的会话，不改变已存在会话的开关。 */
  thinkingDefault: boolean;
  /** 模型全局默认值（仅作新建会话的初始值，localStorage 持久化）。
   * null 表示用后端 env 默认模型。切换它只影响之后新建的会话。 */
  modelDefault: string | null;
  // ---------- actions ----------
  refreshSessions: (keyword?: string) => Promise<void>;
  setActive: (id: number) => void;
  /** 拉取会话详情（含消息列表），若已 loaded 则跳过 */
  ensureLoaded: (id: number) => Promise<void>;
  createSession: (workflow?: WorkflowType) => Promise<void>;
  /** 局部更新会话字段（如切换模型/思考开关），同步 sessions 与 runs[id].session */
  updateSession: (patch: Partial<WorkspaceSession> & { id?: number }) => void;
  /** 设置思考模式全局默认（同步写 localStorage，仅影响之后新建会话） */
  setThinkingDefault: (enable: boolean) => void;
  /** 切换思考模式：空会话（无消息）→ 写全局默认 + 当前会话；中途会话 → 仅写当前会话。
   *  多会话并发时各会话独立，切换会话不会串台。 */
  toggleThinking: (sessionId: number) => void;
  /** 设置模型全局默认（同步写 localStorage，仅影响之后新建会话） */
  setModelDefault: (modelName: string | null) => void;
  /** 选择模型：空会话（无消息）→ 写全局默认 + 当前会话；中途会话 → 仅写当前会话。
   *  与 toggleThinking 同构，多会话并发不会串台。 */
  selectModel: (sessionId: number, modelName: string | null) => void;
  /** 软删除会话（先中止其进行中的流，再调后端删除并从列表移除） */
  deleteSession: (id: number) => Promise<void>;
  /** 重命名会话（调后端 update，同步 sessions 与 runs[id].session） */
  renameSession: (id: number, title: string) => Promise<void>;
  sendMessage: (sessionId: number, input: SendInput) => Promise<void>;
  submitInteraction: (sessionId: number, requestId: string, values: Record<string, unknown>) => Promise<void>;
  /** 续接被中断的 run（A2）。调 resumeSession SSE，复用 submitInteraction 的 AbortController + runPromise 结构。 */
  resumeRun: (sessionId: number) => Promise<void>;
  abort: (sessionId: number) => void;
}

/** 空的 run 入口（懒初始化用） */
function emptyRun(): RunEntry {
  return {
    session: null,
    messages: [],
    runState: INITIAL_RUN_STATE,
    sending: false,
    loaded: false,
  };
}

/**
 * 判断会话是否为「未发送任何消息的空虚拟会话」。
 *
 * 虚拟会话 id 为负数（store.createSession 用 -Date.now()），
 * 且尚未发送首条消息（last_message_time 为空）。
 * 这类会话不在侧栏展示——只有发送首条消息落库为真实会话后才出现。
 *
 * @param session 会话对象
 * @returns true 表示是空虚拟会话（侧栏应过滤掉）
 */
export function isEmptyVirtual(session: WorkspaceSession): boolean {
  return session.id < 0 && (session.last_message_time ?? '') === '';
}

/** 获取/创建 run entry（不可变读取，返回引用便于 set 更新） */
function getRun(runs: Record<number, RunEntry>, id: number): RunEntry {
  return runs[id] ?? emptyRun();
}

// ---------- 模块级：AbortController（非 React state） ----------

const abortControllers = new Map<number, AbortController>();

// 当前进行中的 run promise（含 finally 落库）。sendMessage 入口若发现存在
// 进行中的 run，会先 abort 并 await 此 promise 走完 finally，保证已生成的
// blocks 被 _persist_agent_message 落库后再发新一轮，避免内容丢失。
const runningRunPromises = new Map<number, Promise<void>>();

// ---------- 模块级：思考模式全局默认（localStorage 持久化） ----------

const THINKING_DEFAULT_KEY = 'agent-thinking-default';

/** 读取思考模式全局默认值（localStorage，缺省 false）。 */
function loadThinkingDefault(): boolean {
  try {
    return localStorage.getItem(THINKING_DEFAULT_KEY) === 'true';
  } catch {
    return false;
  }
}

/** 写入思考模式全局默认值（localStorage）。 */
function saveThinkingDefault(enable: boolean): void {
  try {
    localStorage.setItem(THINKING_DEFAULT_KEY, String(enable));
  } catch {
    // localStorage 不可用时静默降级（仅当前会话内有效）
  }
}

const MODEL_DEFAULT_KEY = 'agent-model-default';

/** 读取模型全局默认值（localStorage，缺省 null=用后端 env 默认模型）。 */
function loadModelDefault(): string | null {
  try {
    return localStorage.getItem(MODEL_DEFAULT_KEY);
  } catch {
    return null;
  }
}

/** 写入模型全局默认值（localStorage）。null 时移除键。 */
function saveModelDefault(modelName: string | null): void {
  try {
    if (modelName) localStorage.setItem(MODEL_DEFAULT_KEY, modelName);
    else localStorage.removeItem(MODEL_DEFAULT_KEY);
  } catch {
    // 静默降级
  }
}

/**
 * 后端 session 与本地前端运行时状态合并。
 *
 * 思考开关、模型名是前端会话级状态（随消息发送时携带，不依赖会话持久化）。
 * 后端 session 的这两个字段是 DB 默认值（不再持久化更新），回写时会覆盖
 * 本地值，导致发一条消息后开关/模型被重置。这里强制保留本地已设值。
 *
 * @param remote 后端返回的 session（权威字段：title/current_task_id/...）
 * @param local 本地 runs[id].session（仅取 enable_thinking/selected_model_name）
 * @returns 合并后的 session
 */
function mergeLocalRuntime(
  remote: WorkspaceSession,
  local: WorkspaceSession | null | undefined,
): WorkspaceSession {
  if (!local) return remote;
  return {
    ...remote,
    enable_thinking: local.enable_thinking,
    selected_model_name: local.selected_model_name,
  };
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  sessions: [],
  activeId: null,
  runs: {},
  creating: false,
  thinkingDefault: loadThinkingDefault(),
  modelDefault: loadModelDefault(),

  refreshSessions: async (keyword) => {
    const resp = await employeeAgentApi.listSessions({
      page: 1, page_size: 50, keyword: keyword || undefined,
    });
    const data = resp.data?.data ?? resp.data;
    const items = (data?.items ?? []) as WorkspaceSession[];
    // 兜底降序：即便后端未排序，前端也保证新的在上（按 last_message_time）
    items.sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''));
    set((s) => {
      // 首次加载且无 activeId 时，默认激活第一个会话
      const activeId = s.activeId ?? (items.length ? items[0].id : null);
      // 同步 sessions 列表里的最新字段到 runs[id].session（若已加载）。
      // 思考开关/模型名是前端会话级状态，后端值是 DB 默认值，必须保留本地值不覆盖。
      const runs = { ...s.runs };
      for (const sess of items) {
        const existing = runs[sess.id];
        if (existing?.session) {
          runs[sess.id] = {
            ...existing,
            session: mergeLocalRuntime(sess, existing.session),
          };
        }
      }
      return { sessions: items, activeId, runs };
    });
  },

  setActive: (id) => set({ activeId: id }),

  ensureLoaded: async (id) => {
    if (id < 0) return;  // 虚拟会话不入库，不调后端
    if (get().runs[id]?.loaded) return;
    const resp = await employeeAgentApi.getSession(id);
    const detail = resp.data?.data ?? resp.data;
    if (detail?.session) {
      // 思考开关/模型名是前端会话级状态，后端值为 DB 默认值，保留本地已设值不覆盖
      const localSession = get().runs[id]?.session;
      const session = mergeLocalRuntime(detail.session, localSession);
      set((s) => ({
        runs: {
          ...s.runs,
          [id]: {
            ...getRun(s.runs, id),
            session,
            messages: detail.messages ?? [],
            loaded: true,
          },
        },
      }));
    }
  },

  createSession: async () => {
    // 重入守护：创建中再点击直接返回，避免多次点击生成多个虚拟会话
    if (get().creating) return;
    set({ creating: true });
    // 虚拟会话：负数临时 id，首条消息发送时才真正建会话（sendMessage 内处理）
    // 思考开关/模型继承全局默认（切换全局只影响之后新建的会话）
    const virtualSession: WorkspaceSession = {
      id: -Date.now(),
      session_key: '',
      current_task_id: '',
      employee_id: 0,
      title: null,
      selected_model_name: get().modelDefault,
      enable_thinking: get().thinkingDefault,
      status: 0,
      last_message_time: null,
      create_time: null,
      update_time: null,
    };
    set((s) => {
      // 丢弃其它未发送的虚拟会话，只保留最新一个
      const realSessions = s.sessions.filter(x => x.id >= 0);
      const runs = { ...s.runs };
      for (const id of Object.keys(runs)) {
        if (Number(id) < 0) delete runs[Number(id)];
      }
      runs[virtualSession.id] = {
        session: virtualSession, messages: [], runState: INITIAL_RUN_STATE,
        sending: false, loaded: true,  // 虚拟会话标记 loaded，避免 ensureLoaded 调后端
      };
      return { sessions: [virtualSession, ...realSessions], activeId: virtualSession.id, runs };
    });
    set({ creating: false });
  },

  updateSession: (patch) => {
    const id = patch.id ?? get().activeId;
    if (id === null) return;
    const { id: _omit, ...rest } = patch;
    set((s) => {
      const runs = { ...s.runs };
      const entry = getRun(s.runs, id);
      if (entry.session) {
        runs[id] = { ...entry, session: { ...entry.session, ...rest } };
      }
      const sessions = s.sessions.map((sess) =>
        sess.id === id ? { ...sess, ...rest } : sess,
      );
      return { runs, sessions };
    });
  },

  setThinkingDefault: (enable) => {
    saveThinkingDefault(enable);
    set({ thinkingDefault: enable });
  },

  toggleThinking: (sessionId) => {
    // 空会话（无任何历史消息）切换 = 调整全局默认（且同步当前会话）；
    // 中途会话（已有消息）切换 = 仅调当前会话，不污染全局默认。
    // 多会话并发时各会话独立（状态挂在各自 session 上），切换会话不会串台。
    const entry = get().runs[sessionId];
    const current = !!entry?.session?.enable_thinking;
    const next = !current;
    const isEmpty = (entry?.messages?.length ?? 0) === 0;
    if (isEmpty) {
      get().setThinkingDefault(next);
    }
    get().updateSession({ id: sessionId, enable_thinking: next });
  },

  setModelDefault: (modelName) => {
    saveModelDefault(modelName);
    set({ modelDefault: modelName });
  },

  selectModel: (sessionId, modelName) => {
    // 与 toggleThinking 同构：空会话选择 = 写全局默认 + 当前会话；
    // 中途会话选择 = 仅写当前会话。模型名随消息发送时携带，不落库。
    const entry = get().runs[sessionId];
    const isEmpty = (entry?.messages?.length ?? 0) === 0;
    if (isEmpty) {
      get().setModelDefault(modelName);
    }
    get().updateSession({ id: sessionId, selected_model_name: modelName });
  },

  sendMessage: async (sessionId, input) => {
    // 可中断状态发送：若该会话当前有进行中的 run（流式 / interrupt 暂停），
    // 先中止并 await 其 finally 走完（确保 _persist_agent_message 把已生成的 blocks 落库），
    // 再继续发新一轮，保证中断前的内容不丢失（除了未渲染的不完整业务卡 JSON，由前端 BlockRenderer 自行过滤）。
    const prevRun = runningRunPromises.get(sessionId);
    if (prevRun) {
      abortControllers.get(sessionId)?.abort();
      try { await prevRun; } catch { /* abort 抛错忽略，落库逻辑在 finally 中已完成 */ }
    }

    // 虚拟会话（负 id）：先真正建会话，再发消息
    let realSessionId = sessionId;
    if (sessionId < 0) {
      const virtualId = sessionId;
      set((s) => ({ runs: { ...s.runs, [virtualId]: { ...getRun(s.runs, virtualId), sending: true } } }));
      try {
        const resp = await employeeAgentApi.createSession({ title: undefined });
        const newSession = (resp.data?.data ?? resp.data) as WorkspaceSession;
        realSessionId = newSession.id;
        // 用真实会话替换虚拟会话：迁移 runs/sessions/activeId（保留乐观消息由下方统一追加）
        set((s) => {
          const prevRun = s.runs[virtualId];
          const runs = { ...s.runs };
          delete runs[virtualId];
          runs[newSession.id] = {
            ...(prevRun ?? { messages: [], runState: INITIAL_RUN_STATE, loaded: false }),
            // 后端返回的 newSession 的 enable_thinking/selected_model_name 是 DB 默认值；
            // 这两个是前端会话级状态，用 mergeLocalRuntime 保留虚拟会话期间的本地值。
            session: mergeLocalRuntime(newSession, prevRun?.session),
            sending: true,
          };
          return {
            runs,
            sessions: [newSession, ...s.sessions.filter(x => x.id !== virtualId)],
            activeId: newSession.id,
          };
        });
      } catch (err) {
        // 建会话失败：移除虚拟会话 + 提示，中止发送
        set((s) => {
          const runs = { ...s.runs };
          delete runs[virtualId];
          return {
            runs,
            sessions: s.sessions.filter(x => x.id !== virtualId),
            activeId: s.sessions.find(x => x.id !== virtualId && x.id >= 0)?.id ?? null,
          };
        });
        console.error('建会话失败', err);
        return;
      }
    }

    const ac = new AbortController();
    abortControllers.set(realSessionId, ac);
    set((s) => ({ runs: { ...s.runs, [realSessionId]: { ...getRun(s.runs, realSessionId), sending: true } } }));

    // 乐观追加用户消息（负数临时 id，reload 后替换）
    const optimisticUserMessage: AgentMessage = {
      id: -Date.now(),
      session_id: realSessionId,
      parent_message_id: null,
      role: 'user',
      workflow_type: input.workflow_type,
      run_id: null,
      content: {
        blocks: [{ type: 'text', index: 0, text: input.content, status: 'success' }],
        // 同步带上本次附带的简历引用，使消息列表立即展示文件图标（与后端持久化结构一致）
        context_refs: input.context_refs,
      },
      model_name: null,
      token_count: null,
      sort_order: 0,
      create_time: new Date().toISOString(),
    };
    // 标题乐观更新：首条消息且会话为默认空标题时，本地算标题立即同步
    const optimisticTitle = (() => {
      const entry = get().runs[realSessionId];
      const cur = entry?.session?.title;
      if (cur && !isDefaultTitle(cur)) return null;
      return makeTitleFromContent(input.content);
    })();
    // 乐观 last_message_time：让会话立即进入侧栏「今日」组顶部（bug 3）。
    // 服务端权威值在 run.finish reload 时通过 mergeLocalRuntime 回写覆盖；
    // 客户端时间与服务端可能差几秒，但都在「今日」区间内，分组结果一致，无视觉跳变。
    const optimisticLastMessageTime = new Date().toISOString();
    set((s) => {
      const entry = getRun(s.runs, realSessionId);
      const messages = [...entry.messages, optimisticUserMessage];
      // session 同步乐观更新：标题（仅首条空标题）+ last_message_time（每次都写）
      const sessionPatch: Partial<WorkspaceSession> = {
        last_message_time: optimisticLastMessageTime,
        ...(optimisticTitle ? { title: optimisticTitle } : {}),
      };
      const session = entry.session
        ? { ...entry.session, ...sessionPatch }
        : entry.session;
      const sessions = s.sessions.map((sess) =>
        sess.id === realSessionId ? { ...sess, ...sessionPatch } : sess,
      );
      return { runs: { ...s.runs, [realSessionId]: { ...entry, messages, session } }, sessions };
    });

    // 包装为可被外部 await 的 run promise，注册到 runningRunPromises：
    // 下一轮 sendMessage 会先 abort 并 await 此 promise，确保 finally（含 _persist_agent_message
    // 由 runEnvelopes 内部 reload 拉到落库消息）执行完毕后再发新一轮。
    const runPromise = (async () => {
      try {
        const iter = employeeAgentApi.streamMessage(
          realSessionId,
          {
            content: input.content,
            workflow_type: input.workflow_type,
            context_refs: input.context_refs,
            runtime_options: {
              ...(input.enable_thinking !== undefined ? { enable_thinking: input.enable_thinking } : {}),
              ...(input.model_name ? { model_name: input.model_name } : {}),
            },
          },
          ac.signal,
        );
        await runEnvelopes(realSessionId, iter);
      } finally {
        set((s) => ({ runs: { ...s.runs, [realSessionId]: { ...getRun(s.runs, realSessionId), sending: false } } }));
        abortControllers.delete(realSessionId);
        runningRunPromises.delete(realSessionId);
      }
    })();
    runningRunPromises.set(realSessionId, runPromise);
    await runPromise;
  },

  submitInteraction: async (sessionId, requestId, values) => {
    // 取该会话自身的 workflow_type（最后一条消息 / runState），不串台其它会话
    const entry = get().runs[sessionId];
    const lastMsg = entry?.messages?.[entry.messages.length - 1];
    const workflowType: WorkflowType =
      lastMsg?.workflow_type
      ?? entry?.runState.workflow_type
      ?? 'interview_questions';
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));
    // 同 sendMessage：把 run 包装为 promise 注册到 runningRunPromises，
    // 让"中断后再发"路径能 await 等其落库 finally 执行完。
    const runPromise = (async () => {
      try {
        const enableThinking = !!entry?.session?.enable_thinking;
        const modelName = entry?.session?.selected_model_name ?? null;
        const iter = employeeAgentApi.submitInteraction(
          sessionId, requestId, values, workflowType,
          { enableThinking, modelName }, ac.signal,
        );
        await runEnvelopes(sessionId, iter);
      } finally {
        set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: false } } }));
        abortControllers.delete(sessionId);
        runningRunPromises.delete(sessionId);
      }
    })();
    runningRunPromises.set(sessionId, runPromise);
    await runPromise;
  },

  resumeRun: async (sessionId) => {
    // 续接被中断的 run：从历史消息/runState 取 workflow_type（与 submitInteraction 同源逻辑），
    // 复用其 AbortController + runPromise 结构，保证可被中断 / finally 清理。
    const entry = get().runs[sessionId];
    const lastMsg = entry?.messages?.[entry.messages.length - 1];
    const workflowType: WorkflowType =
      lastMsg?.workflow_type ?? entry?.runState.workflow_type ?? 'interview_questions';
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));
    // 同 submitInteraction：把 run 包装为 promise 注册到 runningRunPromises，
    // 让"中断后再发"路径能 await 等其落库 finally 执行完。
    const runPromise = (async () => {
      try {
        const enableThinking = !!entry?.session?.enable_thinking;
        const modelName = entry?.session?.selected_model_name ?? null;
        const iter = employeeAgentApi.resumeSession(
          sessionId, workflowType, { enableThinking, modelName }, ac.signal,
        );
        await runEnvelopes(sessionId, iter);
      } finally {
        set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: false } } }));
        abortControllers.delete(sessionId);
        runningRunPromises.delete(sessionId);
      }
    })();
    runningRunPromises.set(sessionId, runPromise);
    await runPromise;
  },

  deleteSession: async (id) => {
    // 先中止该会话进行中的流，避免删除后流仍悬挂
    abortControllers.get(id)?.abort();
    abortControllers.delete(id);
    await employeeAgentApi.deleteSession(id);
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      const activeId = s.activeId === id
        ? (sessions[0]?.id ?? null)
        : s.activeId;
      const runs = { ...s.runs };
      delete runs[id];
      return { sessions, activeId, runs };
    });
  },

  renameSession: async (id, title) => {
    await employeeAgentApi.updateSession(id, { title });
    set((s) => {
      const sessions = s.sessions.map((x) => (x.id === id ? { ...x, title } : x));
      const runs = { ...s.runs };
      const entry = runs[id];
      if (entry?.session) runs[id] = { ...entry, session: { ...entry.session, title } };
      return { sessions, runs };
    });
  },

  abort: (sessionId) => {
    // 中断分两路径：
    // 1) 流式 run 进行中（ac 存在）→ fetch.abort() 切断流，后端 finally 落库（含中断前内容）
    // 2) interrupt 暂停态（ac 已 delete）→ 调后端 /abort 端点：
    //    标记 pending interaction block 为 expired + 推进 task_id，再 reload 拉到落库消息
    const ac = abortControllers.get(sessionId);
    if (ac) {
      ac.abort();
      return;
    }
    // 路径 2：interrupt 态。fire-and-forget 调后端，再 reload 同步前端 UI。
    void (async () => {
      try {
        await employeeAgentApi.abortSession(sessionId);
      } catch (err) {
        console.error('中断 interrupt 失败', err);
        return;
      }
      // 重新拉会话详情：覆盖最近一条消息的 blocks（pending → expired），
      // 让 hasPendingInteraction 变为 false，按钮回到蓝色"发送"。
      try {
        const resp = await employeeAgentApi.getSession(sessionId);
        const detail = resp.data?.data ?? resp.data;
        useAgentStore.setState((s) => {
          const entry = getRun(s.runs, sessionId);
          const remoteSession = (detail?.session ?? entry.session) as WorkspaceSession | null;
          const session = remoteSession
            ? mergeLocalRuntime(remoteSession, entry.session)
            : entry.session;
          return {
            runs: {
              ...s.runs,
              [sessionId]: {
                ...entry,
                session,
                messages: detail?.messages ?? entry.messages,
                loaded: true,
              },
            },
          };
        });
      } catch (err) {
        console.error('中断后 reload 会话失败', err);
      }
    })();
  },
}));

// ---------- 流式消费循环（模块级，与组件解耦） ----------

/**
 * 消费 envelope 迭代器并 dispatch 到对应会话的 runState。
 *
 * run.finish 不立即 dispatch：先 reload 拿到落库后的 agent 消息，
 * 然后**单次 setState 同时**完成「替换 messages + 清空 current_blocks + running=false」，
 * 避免双 setState 间的中间态被 React 渲染（流式卡先消失再出现新消息卡 = 闪烁）。
 * runState 直接重置为 INITIAL_RUN_STATE，效果等同 reducer(run.finish) 但更彻底。
 */
async function runEnvelopes(sessionId: number, iter: AsyncIterableIterator<AgentEnvelope>) {
  let pendingFinish: AgentEnvelope | null = null;
  let hasError = false;
  const dispatch = (env: AgentEnvelope) => {
    useAgentStore.setState((s) => {
      const entry = getRun(s.runs, sessionId);
      return {
        runs: {
          ...s.runs,
          [sessionId]: { ...entry, runState: agentRunReducer(entry.runState, env) },
        },
      };
    });
  };
  try {
    for await (const env of iter) {
      if (env.type === 'run.finish') {
        pendingFinish = env;
        continue;
      }
      // run.error：先 dispatch 让 reducer 写入 runState.error（红色提示数据源），
      // 同时标记 hasError 让收尾保留错误态（不被随后的 run.finish 重置清空）。
      if (env.type === 'run.error') hasError = true;
      dispatch(env);
    }
  } catch (err) {
    // fetch.abort() / 网络断开 → AbortError：后端的 finally 仍会落库已生成 envelopes，
    // 吞掉该错误后走下方无条件收尾，把落库消息 reload 到前端；非 abort 错误照常上抛。
    const isAbort =
      err instanceof DOMException && err.name === 'AbortError'
      || (err as { name?: string })?.name === 'AbortError';
    if (!isAbort) throw err;
  }
  // 收尾：无条件执行。正常 finish / 客户端 abort / 后端 error / 流自然结束（无任何终态
  // envelope，如代理意外断开）都走同一收尾——reload 落库消息 + 结算 runState，
  // 避免流式卡与 pending 交互卡残留。reload 是幂等的（仅重新拉会话），多走一次无副作用。
  {
    // 强制重新拉取落库消息（覆盖乐观消息），再单次 setState 切换流式卡 → 新消息
    const resp = await employeeAgentApi.getSession(sessionId);
    const detail = resp.data?.data ?? resp.data;
    // run.finish 携带的 next_task_id：后端在 graph 正常 END 时已 update session 表；
    // abort 路径无 finish envelope，task_id 由后端 finally 决定（中断不推进，保证 resume 命中）。
    const nextTaskId = pendingFinish
      ? ((pendingFinish.data as { next_task_id?: string }).next_task_id ?? null)
      : null;
    useAgentStore.setState((s) => {
      const entry = getRun(s.runs, sessionId);
      // getSession 回写的 session 来自后端，其 enable_thinking/selected_model_name 是 DB 默认值
      // （后端已不持久化这两个运行时状态）。它们是前端会话级状态，这里必须保留本地值，
      // 否则发送一条消息后开关/模型会被重置。
      const remoteSession = (detail?.session ?? entry.session) as WorkspaceSession | null;
      const session = remoteSession
        ? mergeLocalRuntime(remoteSession, entry.session)
        : entry.session;
      if (session && nextTaskId) session.current_task_id = nextTaskId;
      return {
        runs: {
          ...s.runs,
          [sessionId]: {
            ...entry,
            session,
            messages: detail?.messages ?? entry.messages,
            loaded: true,
            // 单次 setState 完成「running=false + 清空 current_blocks + 切到落库消息」三件事，
            // React 一次提交切换 UI，避免帧间留白。steps/error 是否保留交由 resolveRunStateAfterFinish。
            runState: resolveRunStateAfterFinish(entry.runState, {
              hasFinish: Boolean(pendingFinish),
              nextTaskId,
              hasError,
            }),
          },
        },
      };
    });
  }
}

/**
 * 计算 run 收尾后的 runState（决定步骤进度是否跨「中断段」累积、错误态是否保留）。
 *
 * 背景：图一/图二都会被 interaction 中断（选维度、确认计划、选岗位等）拆成多个
 * run 段，每段以 run.finish 结束。此前收尾时无条件把 runState 重置为 INITIAL
 * （steps=[]、error=null），导致两个 bug：
 * 1. 每段都从 0 重新计数 step.update，进度条永远停在「1/8 + 当前运行中节点」。
 * 2. run.error 写入的错误态被随后的收尾清空，红色错误提示一闪而过甚至看不到。
 *
 * 三种结束路径（按优先级判定）：
 * - 错误终态（hasError）：保留 steps（含失败步，红X 可见）+ 保留 error（红色提示数据源）。
 *   running 仍置 false（流程已停），下一轮用户重试 / 新问题时由 run.start 重置。
 *   错误终态优先级最高 —— graph 异常时 next_task_id 也为 null，绝不能被误判为中断段。
 * - 中断段（hasFinish 且 next_task_id 为 null，且无错误）：后端 interrupt 不推进 task_id
 *   → 保留已累积 steps，下一段 resume（run.start.resume=true，reducer 不清 steps）继续累积。
 * - 真正 END（next_task_id 非空）/ 客户端 abort：全量清空，下一轮从 0 起跑。
 *
 * 除错误态外，running 一律置 false、current_blocks 清空（INITIAL 默认值），
 * workflow_type 始终保留（同会话工作流类型不变）。
 *
 * @param prev - 收尾前的 runState（含已累积 steps 与可能的 error）
 * @param finish - 收尾上下文：hasFinish 是否收到 run.finish；nextTaskId 其携带的 task_id；
 *                 hasError 本 run 是否收到 run.error
 * @returns 收尾后的新 runState
 */
export function resolveRunStateAfterFinish(
  prev: AgentRunState,
  finish: { hasFinish: boolean; nextTaskId: string | null; hasError?: boolean },
): AgentRunState {
  // 错误终态：保留 steps（失败步可见）+ error（红色提示），优先于中断段判定
  if (finish.hasError) {
    return {
      ...INITIAL_RUN_STATE,
      workflow_type: prev.workflow_type,
      steps: prev.steps,
      error: prev.error,
    };
  }
  // 中断段：收到 finish 且未推进 task_id → 保留 steps 让进度跨段累积
  const isInterruptPause = finish.hasFinish && !finish.nextTaskId;
  return {
    ...INITIAL_RUN_STATE,
    workflow_type: prev.workflow_type,
    ...(isInterruptPause ? { steps: prev.steps } : {}),
  };
}

// ---------- 派生 selectors ----------

/**
 * 正在运行的会话 id 集合（用于侧栏加载图标）。
 *
 * 选择器必须返回引用稳定的值：Zustand 默认用 Object.is 比较，
 * 若返回 new Set() 这种每次新建的对象会触发"getSnapshot 未缓存"无限重渲染。
 * 因此 selector 返回原始类型 string（逗号分隔 id，按值比较稳定），
 * 再用 useMemo 派生为 Set 供消费方使用。
 */
export function useRunningSessionIds(): Set<number> {
  const idsStr = useAgentStore((s) => {
    const running: number[] = [];
    for (const [id, entry] of Object.entries(s.runs)) {
      if (entry.runState.running) running.push(Number(id));
    }
    return running.sort((a, b) => a - b).join(',');
  });
  return useMemo(() => {
    if (!idsStr) return EMPTY_SET;
    return new Set(idsStr.split(',').map(Number));
  }, [idsStr]);
}

/** 空集合单例，避免无运行会话时每次 useMemo 新建 Set */
const EMPTY_SET: Set<number> = new Set();
