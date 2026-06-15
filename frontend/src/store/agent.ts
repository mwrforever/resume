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
  context_refs?: Array<Record<string, unknown>>;
}

interface AgentStoreState {
  sessions: WorkspaceSession[];
  activeId: number | null;
  runs: Record<number, RunEntry>;
  // ---------- actions ----------
  refreshSessions: (keyword?: string) => Promise<void>;
  setActive: (id: number) => void;
  /** 拉取会话详情（含消息列表），若已 loaded 则跳过 */
  ensureLoaded: (id: number) => Promise<void>;
  createSession: (workflow?: WorkflowType) => Promise<void>;
  /** 局部更新会话字段（如切换模型/思考开关），同步 sessions 与 runs[id].session */
  updateSession: (patch: Partial<WorkspaceSession> & { id?: number }) => void;
  sendMessage: (sessionId: number, input: SendInput) => Promise<void>;
  submitInteraction: (sessionId: number, requestId: string, values: Record<string, unknown>) => Promise<void>;
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

/** 获取/创建 run entry（不可变读取，返回引用便于 set 更新） */
function getRun(runs: Record<number, RunEntry>, id: number): RunEntry {
  return runs[id] ?? emptyRun();
}

// ---------- 模块级：AbortController（非 React state） ----------

const abortControllers = new Map<number, AbortController>();

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  sessions: [],
  activeId: null,
  runs: {},

  refreshSessions: async (keyword) => {
    const resp = await employeeAgentApi.listSessions({
      page: 1, page_size: 50, keyword: keyword || undefined,
    });
    const data = resp.data?.data ?? resp.data;
    const items = (data?.items ?? []) as WorkspaceSession[];
    set((s) => {
      // 首次加载且无 activeId 时，默认激活第一个会话
      const activeId = s.activeId ?? (items.length ? items[0].id : null);
      // 同步 sessions 列表里的最新字段到 runs[id].session（若已加载）
      const runs = { ...s.runs };
      for (const sess of items) {
        if (runs[sess.id]?.session) {
          runs[sess.id] = { ...runs[sess.id], session: { ...runs[sess.id].session!, ...sess } };
        }
      }
      return { sessions: items, activeId, runs };
    });
  },

  setActive: (id) => set({ activeId: id }),

  ensureLoaded: async (id) => {
    if (get().runs[id]?.loaded) return;
    const resp = await employeeAgentApi.getSession(id);
    const detail = resp.data?.data ?? resp.data;
    if (detail?.session) {
      set((s) => ({
        runs: {
          ...s.runs,
          [id]: {
            ...getRun(s.runs, id),
            session: detail.session,
            messages: detail.messages ?? [],
            loaded: true,
          },
        },
      }));
    }
  },

  createSession: async () => {
    const resp = await employeeAgentApi.createSession({ title: undefined });
    const s = (resp.data?.data ?? resp.data) as WorkspaceSession;
    set((state) => ({
      sessions: [s, ...state.sessions],
      activeId: s.id,
    }));
    void get().ensureLoaded(s.id);
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

  sendMessage: async (sessionId, input) => {
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));

    // 乐观追加用户消息（负数临时 id，reload 后替换）
    const optimisticUserMessage: AgentMessage = {
      id: -Date.now(),
      session_id: sessionId,
      parent_message_id: null,
      role: 'user',
      workflow_type: input.workflow_type,
      run_id: null,
      content: { blocks: [{ type: 'text', index: 0, text: input.content, status: 'success' }] },
      model_name: null,
      token_count: null,
      sort_order: 0,
      create_time: new Date().toISOString(),
    };
    // 标题乐观更新：首条消息且会话为默认空标题时，本地算标题立即同步
    const optimisticTitle = (() => {
      const entry = get().runs[sessionId];
      const cur = entry?.session?.title;
      if (cur && !isDefaultTitle(cur)) return null;
      return makeTitleFromContent(input.content);
    })();
    set((s) => {
      const entry = getRun(s.runs, sessionId);
      const messages = [...entry.messages, optimisticUserMessage];
      const session = optimisticTitle && entry.session
        ? { ...entry.session, title: optimisticTitle }
        : entry.session;
      const sessions = optimisticTitle
        ? s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, title: optimisticTitle } : sess,
          )
        : s.sessions;
      return { runs: { ...s.runs, [sessionId]: { ...entry, messages, session } }, sessions };
    });

    try {
      const iter = employeeAgentApi.streamMessage(
        sessionId,
        {
          content: input.content,
          workflow_type: input.workflow_type,
          context_refs: input.context_refs,
          runtime_options: input.enable_thinking !== undefined
            ? { enable_thinking: input.enable_thinking } : undefined,
        },
        ac.signal,
      );
      await runEnvelopes(sessionId, iter);
    } finally {
      set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: false } } }));
      abortControllers.delete(sessionId);
    }
  },

  submitInteraction: async (sessionId, requestId, values) => {
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));
    try {
      const iter = employeeAgentApi.submitInteraction(sessionId, requestId, values, ac.signal);
      await runEnvelopes(sessionId, iter);
    } finally {
      set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: false } } }));
      abortControllers.delete(sessionId);
    }
  },

  abort: (sessionId) => {
    abortControllers.get(sessionId)?.abort();
  },
}));

// ---------- 流式消费循环（模块级，与组件解耦） ----------

/**
 * 消费 envelope 迭代器并 dispatch 到对应会话的 runState。
 *
 * run.finish 不立即 dispatch：先 reload 拿到落库后的 agent 消息，
 * 再紧随其后 dispatch run.finish 清空 current_blocks。两步在同一微任务延续中，
 * React 18 自动批处理，单帧完成"流式卡片 → 新消息"对调，避免留白闪烁。
 * 完成后重置 runState（清空 current_blocks 控制内存），保留 messages。
 */
async function runEnvelopes(sessionId: number, iter: AsyncIterableIterator<AgentEnvelope>) {
  let pendingFinish: AgentEnvelope | null = null;
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
  for await (const env of iter) {
    if (env.type === 'run.finish') {
      pendingFinish = env;
      continue;
    }
    dispatch(env);
  }
  if (pendingFinish) {
    // 强制重新拉取落库消息（覆盖乐观消息），再清空流式状态
    const resp = await employeeAgentApi.getSession(sessionId);
    const detail = resp.data?.data ?? resp.data;
    useAgentStore.setState((s) => {
      const entry = getRun(s.runs, sessionId);
      return {
        runs: {
          ...s.runs,
          [sessionId]: {
            ...entry,
            session: detail?.session ?? entry.session,
            messages: detail?.messages ?? entry.messages,
            loaded: true,
            runState: agentRunReducer(entry.runState, pendingFinish!),
          },
        },
      };
    });
    // run.finish 已把 running 置 false；再重置 runState 清空 current_blocks 释放内存
    useAgentStore.setState((s) => {
      const entry = getRun(s.runs, sessionId);
      return {
        runs: {
          ...s.runs,
          [sessionId]: {
            ...entry,
            runState: { ...INITIAL_RUN_STATE, workflow_type: entry.runState.workflow_type },
          },
        },
      };
    });
  }
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
