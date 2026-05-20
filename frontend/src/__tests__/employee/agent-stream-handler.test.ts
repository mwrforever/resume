import { describe, it, expect } from 'vitest';
import { parseAgentStreamEnvelopeV1, getUiComponentKey, parsePlanReviewTreeData } from '@/utils/agent-stream-v1';

describe('agent-stream-v1', () => {
  describe('parseAgentStreamEnvelopeV1', () => {
    it('should parse valid v1 envelope', () => {
      const data = {
        protocol_version: '1.0',
        seq: 1,
        event_type: 'lifecycle.node_enter',
        payload: { node_id: 'analyst' },
      };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).not.toBeNull();
      expect(result?.event_type).toBe('lifecycle.node_enter');
    });

    it('should return null for invalid version', () => {
      const data = { protocol_version: '2.0', seq: 1, event_type: 'test', payload: {} };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).toBeNull();
    });

    it('should return null for missing seq', () => {
      const data = { protocol_version: '1.0', event_type: 'test', payload: {} };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).toBeNull();
    });
  });

  describe('getUiComponentKey', () => {
    it('should return PlanReviewTree for PlanReviewTree key', () => {
      const result = getUiComponentKey({ component_key: 'PlanReviewTree' });
      expect(result).toBe('PlanReviewTree');
    });

    it('should return PlanRepairHints for PlanRepairHints key', () => {
      const result = getUiComponentKey({ component_key: 'PlanRepairHints' });
      expect(result).toBe('PlanRepairHints');
    });

    it('should return ActionConfirmCard for ActionConfirmCard key', () => {
      const result = getUiComponentKey({ component_key: 'ActionConfirmCard' });
      expect(result).toBe('ActionConfirmCard');
    });

    it('should return null for unknown key', () => {
      const result = getUiComponentKey({ component_key: 'Unknown' });
      expect(result).toBeNull();
    });

    it('should return null for AgentStatusTimeline key (not in allowlist)', () => {
      const result = getUiComponentKey({ component_key: 'AgentStatusTimeline' });
      expect(result).toBeNull();
    });
  });

  describe('parsePlanReviewTreeData', () => {
    it('should parse valid plan review data', () => {
      const data = {
        revision: 1,
        max_revisions: 3,
        tasks: [
          { task_id: 't1', domain: 'job', title: '任务1', instruction: '执行任务1' },
          { task_id: 't2', domain: 'application', title: '任务2', instruction: '执行任务2' },
        ],
      };
      const result = parsePlanReviewTreeData(data);
      expect(result).not.toBeNull();
      expect(result?.revision).toBe(1);
      expect(result?.tasks.length).toBe(2);
    });

    it('should return null for empty tasks', () => {
      const data = { revision: 1, tasks: [] };
      const result = parsePlanReviewTreeData(data);
      expect(result).toBeNull();
    });

    it('should return null for missing tasks', () => {
      const data = { revision: 1 };
      const result = parsePlanReviewTreeData(data);
      expect(result).toBeNull();
    });
  });
});