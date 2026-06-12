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
 */

import type { AgentEnvelope } from '@/types/agent';

const FRAME_SEPARATOR = '\n\n';

/**
 * 从单条 SSE frame 中解析 AgentEnvelope。
 *
 * @param frame - 单条 SSE frame（不含 \n\n 分隔符）
 * @returns 解析成功返回 AgentEnvelope，否则 null
 */
export function parseSseFrame(frame: string): AgentEnvelope | null {
  if (!frame.trim()) return null;
  let eventName: string | null = null;
  let dataLine: string | null = null;
  for (const rawLine of frame.split('\n')) {
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
  const init: RequestInit = {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(options.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options.signal,
  };
  const resp = await fetch(url, init);
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE 连接失败：${resp.status} ${resp.statusText}`);
  }
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf(FRAME_SEPARATOR)) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + FRAME_SEPARATOR.length);
      const env = parseSseFrame(frame);
      if (env) yield env;
    }
  }
}
