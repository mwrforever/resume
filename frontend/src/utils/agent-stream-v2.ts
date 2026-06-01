import type { IAgentStreamEnvelopeV2 } from '@/types/agent';

/** 解析 SSE data 为 v2 信封；协议版本不匹配时返回 null */
export function parseAgentStreamEnvelopeV2(data: Record<string, unknown>): IAgentStreamEnvelopeV2 | null {
  if (data.schema_version !== '2.0') {
    return null;
  }
  if (typeof data.seq !== 'number' || typeof data.event !== 'string') {
    return null;
  }
  if (typeof data.run_id !== 'string' || typeof data.session_id !== 'number') {
    return null;
  }
  if (typeof data.node_id !== 'string' || typeof data.ts !== 'number') {
    return null;
  }
  return data as unknown as IAgentStreamEnvelopeV2;
}

export const AGENT_STREAM_PROTOCOL_V2 = '2.0' as const;
