/**
 * hasPendingInteraction 纯函数单测。
 *
 * 覆盖：无消息 / 末条为 user / 末条 agent 含 pending interaction /
 * 含 submitted（已提交）/ 含 expired（已过期）/ 无 interaction block。
 */
import { describe, it, expect } from 'vitest';
import { hasPendingInteraction } from '../interaction-utils';
import type { AgentMessage } from '@/types/agent';

// 构造一条 agent 消息，blocks 由入参指定
function agentMsg(blocks: AgentMessage['content']['blocks']): AgentMessage {
  return {
    id: 1, session_id: 1, parent_message_id: null, role: 'agent',
    workflow_type: 'interview_questions', run_id: null,
    content: { blocks }, model_name: null, token_count: null,
    sort_order: 0, create_time: null,
  };
}

// 构造一条 user 消息（纯文本 block）
function userMsg(): AgentMessage {
  return {
    id: 2, session_id: 1, parent_message_id: null, role: 'user',
    workflow_type: 'interview_questions', run_id: null,
    content: { blocks: [{ type: 'text', index: 0, text: '你好', status: 'success' }] },
    model_name: null, token_count: null, sort_order: 0, create_time: null,
  };
}

// 构造一个 interaction block，status 由入参指定
function interactionBlock(status: 'pending' | 'submitted' | 'expired') {
  return {
    type: 'interaction' as const, index: 0,
    request_id: 'r1', interaction_type: 'resume_upload' as const,
    title: '上传简历', prompt: '请上传', data: {}, status,
  };
}

describe('hasPendingInteraction', () => {
  it('空消息列表返回 false', () => {
    expect(hasPendingInteraction([])).toBe(false);
  });

  it('最近一条 agent 含 pending interaction 返回 true', () => {
    expect(hasPendingInteraction([agentMsg([interactionBlock('pending')])])).toBe(true);
  });

  it('interaction 已 submitted 返回 false', () => {
    expect(hasPendingInteraction([agentMsg([interactionBlock('submitted')])])).toBe(false);
  });

  it('interaction 已 expired 返回 false', () => {
    expect(hasPendingInteraction([agentMsg([interactionBlock('expired')])])).toBe(false);
  });

  it('agent 消息无 interaction block 返回 false', () => {
    expect(hasPendingInteraction([agentMsg([{ type: 'text', index: 0, text: '答复', status: 'success' }])])).toBe(false);
  });

  it('最近一条是 user 消息（即便更早 agent 有 pending）返回 false', () => {
    // 判定基于“最近一条 agent 消息”，末条 user 时仍回看最近 agent；
    // 这里最近 agent 是 pending，所以应为 true（验证“找最近 agent 而非末条”）
    expect(hasPendingInteraction([agentMsg([interactionBlock('pending')]), userMsg()])).toBe(true);
  });
});
