/**
 * Agent SSE 流式客户端。
 *
 * 不依赖 EventSource（不支持 POST + 自定义 header）。
 * 用 fetch + ReadableStream 自行解析 SSE frame。
 *
 * 解析规则：
 * - frame 间分隔 "\n\n"
 * - 行内 "event: agent" 标识 agent envelope，data 为 JSON
 * - 非 agent event / JSON 解析失败 / 未知 type 静默忽略
 *
 * 鉴权：fetch 不走 axios，因此必须自行从 auth store 取 access_token 注入
 * Authorization header；遇到 401 时复用 axios 端的 refresh 流程并重试一次。
 */

import axios from 'axios';
import type { AgentEnvelope } from '@/types/agent';
import { useAuthStore } from '@/store/auth';

// 帧分隔符正则：兼容 SSE 规范允许的三种行尾（CRLF / LF / CR）。
// 后端 sse-starlette 默认使用 "\r\n"，整帧以 "\r\n\r\n" 结束；
// 但浏览器 EventSource 与多数代理同时支持 "\n\n"，这里全部接住。
const FRAME_SEPARATOR_REGEX = /\r\n\r\n|\n\n|\r\r/;

/**
 * 从单条 SSE frame 中解析 AgentEnvelope。
 *
 * @param frame - 单条 SSE frame（不含帧间空行分隔符）
 * @returns 解析成功返回 AgentEnvelope，否则 null
 */
export function parseSseFrame(frame: string): AgentEnvelope | null {
  if (!frame.trim()) return null;
  let eventName: string | null = null;
  let dataLine: string | null = null;
  // 兼容三种行尾，统一按 \n 切再 trim 去掉残留的 \r
  for (const rawLine of frame.split(/\r\n|\n|\r/)) {
    if (rawLine.startsWith('event:')) {
      eventName = rawLine.slice(6).trim();
    } else if (rawLine.startsWith('data:')) {
      dataLine = rawLine.slice(5).trim();
    }
  }
  if (eventName !== 'agent' || !dataLine) return null;
  try {
    return JSON.parse(dataLine) as AgentEnvelope;
  } catch {
    return null;
  }
}

/** openAgentStream 可选配置 */
export interface OpenAgentStreamOptions {
  method?: 'POST' | 'GET';
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * 打开 SSE 流并 yield AgentEnvelope。
 *
 * @param url - 请求地址
 * @param body - POST 请求体
 * @param options - 可选配置（method / headers / signal）
 * @yields AgentEnvelope 按到达顺序
 * @throws SSE 连接失败时抛出错误
 */
export async function* openAgentStream(
  url: string,
  body: unknown,
  options: OpenAgentStreamOptions = {},
): AsyncIterableIterator<AgentEnvelope> {
  // 401 时仅自动 refresh + 重试一次，避免无限循环
  const resp = await fetchWithAuth(url, body, options, /* allowRetry */ true);
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE 连接失败：${resp.status} ${resp.statusText}`);
  }
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    // 用正则切分帧，确保按"先到先切"的位置精准消费每个帧
    while (true) {
      const match = FRAME_SEPARATOR_REGEX.exec(buf);
      if (!match) break;
      const frame = buf.slice(0, match.index);
      buf = buf.slice(match.index + match[0].length);
      const env = parseSseFrame(frame);
      if (env) yield env;
    }
  }
}

// ---------- 内部：鉴权与刷新 token ----------

/** 与 client.ts 保持单例的 refresh 并发锁，防止多个 SSE 连接同时触发 refresh */
let refreshPromise: Promise<string | null> | null = null;

/** 调用后端 refresh 接口换取新 access_token；失败返回 null 并 logout */
function doRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const { refreshToken, userType } = useAuthStore.getState();
    if (!refreshToken || !userType) return null;
    try {
      const refreshUrl =
        userType === 'employee' ? '/employee/auth/refresh' : '/user/auth/refresh';
      const res = await axios.post(`/api/v1${refreshUrl}`, { refresh_token: refreshToken });
      const data = res.data?.data;
      if (!data?.access_token || !data?.refresh_token) return null;
      useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
      return data.access_token as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** 注入 Authorization 后发起 fetch；遇 401 自动 refresh + 重试一次 */
async function fetchWithAuth(
  url: string,
  body: unknown,
  options: OpenAgentStreamOptions,
  allowRetry: boolean,
): Promise<Response> {
  const token = useAuthStore.getState().accessToken;
  const init: RequestInit = {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options.signal,
  };
  const resp = await fetch(url, init);
  if (resp.status !== 401 || !allowRetry) return resp;

  // 401：尝试刷新一次 token 后用新 token 重试
  const newToken = await doRefresh();
  if (!newToken) {
    useAuthStore.getState().logout();
    return resp;
  }
  return fetchWithAuth(url, body, options, /* allowRetry */ false);
}
