import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentInteractionCard } from '@/components/employee/agent/agent-interaction-card';
import { AgentMessageList } from '@/components/employee/agent/agent-message-list';
import { AgentRunCompactTimeline } from '@/components/employee/agent/agent-run-compact-timeline';
import { AgentThinkingPanel } from '@/components/employee/agent/agent-thinking-panel';
import { InterviewQuestionSetCard } from '@/components/employee/agent/interview-question-set-card';
import { ResumeEvaluationReportCard } from '@/components/employee/agent/resume-evaluation-report-card';
import type { IAgentMessageItem } from '@/types/agent';


describe('agent compact workflow components', () => {
  it('renders compact timeline collapsed summary and expands details', async () => {
    render(
      <AgentRunCompactTimeline
        items={[
          { id: 'step-1', type: 'node', status: 'success', title: '读取简历' },
          { id: 'step-2', type: 'node', status: 'running', title: '生成问题' },
        ]}
      />,
    );

    expect(screen.getByText('运行过程 · 已完成 1 步')).toBeInTheDocument();
    expect(screen.queryByText('读取简历')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开运行过程' }));

    expect(screen.getByText('读取简历')).toBeInTheDocument();
  });

  it('renders thinking panel collapsed and reveals content on demand', async () => {
    render(<AgentThinkingPanel item={{ id: 'think-1', run_id: 'run-1', status: 'streaming', content: '正在分析简历结构' }} />);

    expect(screen.getByText('思考过程 · 生成中')).toBeInTheDocument();
    expect(screen.queryByText('正在分析简历结构')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开思考过程' }));

    expect(screen.getByText('正在分析简历结构')).toBeInTheDocument();
  });

  it('submits selected dimensions from interaction card', async () => {
    const onSubmit = vi.fn();
    render(
      <AgentInteractionCard
        item={{
          id: 'req-1',
          run_id: 'run-1',
          interaction_type: 'dimension_selection',
          title: '选择面试维度',
          prompt: '请选择本次面试重点',
          data: { dimensions: [{ name: '项目深度' }, { name: '沟通表达' }] },
          submit_label: '确认维度',
          status: 'pending',
        }}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: '项目深度' }));
    await userEvent.click(screen.getByRole('button', { name: '确认维度' }));

    expect(onSubmit).toHaveBeenCalledWith('req-1', { selected_dimensions: ['项目深度'] });
  });
});


describe('agent business cards', () => {
  const questionSet = {
    title: '面试题清单',
    total_questions: 1,
    dimensions: ['项目深度'],
    questions: [
      {
        question: '请介绍项目贡献',
        dimension: '项目深度',
        difficulty: '中等',
        evaluation_points: ['真实贡献'],
        follow_up_suggestions: ['追问关键决策'],
        excellent_signals: ['能量化结果'],
        average_signals: [],
        risk_signals: [],
      },
    ],
  };

  const report = {
    final_score: 82,
    final_label: '良好',
    decision: '建议进入面试',
    summary: '匹配度较高',
    match_overview: { advantages: ['项目经验匹配'], risks: ['管理经验不足'] },
    resume_structure: { completeness: '完整' },
    experience_timeline: [{ period: '2022-2024', title: '前端工程师', summary: '负责核心项目' }],
    skill_dimensions: [{ name: 'React', score: 86, evidence: '项目经历充分' }],
    job_gaps: [{ title: '团队管理', severity: 'medium', suggestion: '面试追问' }],
  };

  it('renders interview question set grouped content', () => {
    render(<InterviewQuestionSetCard questionSet={questionSet} />);

    expect(screen.getByText('面试题清单')).toBeInTheDocument();
    expect(screen.getByText('项目深度')).toBeInTheDocument();
    expect(screen.getByText('请介绍项目贡献')).toBeInTheDocument();
    expect(screen.getByText('真实贡献')).toBeInTheDocument();
  });

  it('renders resume evaluation report summary', () => {
    render(<ResumeEvaluationReportCard report={report} />);

    expect(screen.getByText('简历评估报告')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('建议进入面试')).toBeInTheDocument();
    expect(screen.getByText('项目经验匹配')).toBeInTheDocument();
  });

  it('restores historical stream events and business card blocks', () => {
    const messages: IAgentMessageItem[] = [
      {
        id: 1,
        session_id: 1,
        parent_message_id: null,
        role: 'agent',
        message_type: 'text',
        content: {
          context_refs: [],
          blocks: [
            { type: 'text', text: '已生成面试题。' },
            {
              type: 'stream_events',
              schema_version: '2.0',
              events: [
                {
                  schema_version: '2.0',
                  seq: 1,
                  run_id: 'run-1',
                  session_id: 1,
                  node_id: 'interview_questions',
                  event: 'execution_status',
                  payload: { status: 'success', title: '生成问题' },
                  ts: 1,
                },
                {
                  schema_version: '2.0',
                  seq: 2,
                  run_id: 'run-1',
                  session_id: 1,
                  node_id: 'dimension_selection',
                  event: 'interaction_request',
                  payload: { request_id: 'req-1', interaction_type: 'dimension_selection', title: '选择维度', prompt: '请选择维度', data: {}, submit_label: '确认' },
                  ts: 2,
                },
                {
                  schema_version: '2.0',
                  seq: 3,
                  run_id: 'run-1',
                  session_id: 1,
                  node_id: 'dimension_selection',
                  event: 'interaction_result',
                  payload: { request_id: 'req-1' },
                  ts: 3,
                },
              ],
            },
            { type: 'interview_question_set', question_set: questionSet },
          ],
        },
        model_name: 'qwen-plus',
        token_count: null,
        sort_order: 1,
        create_time: null,
      },
    ];

    render(
      <AgentMessageList
        messages={messages}
        actionsByMessageId={new Map()}
        runtimeFeedItems={[]}
        planReview={null}
        sending={false}
        errorMessage=""
        messagesEndRef={{ current: null }}
        onConfirmAction={() => undefined}
        onRejectAction={() => undefined}
        onPlanReviewFeedbackChange={() => undefined}
        onPlanReviewTaskInstructionChange={() => undefined}
        onPlanReviewApprove={() => undefined}
        onPlanReviewReject={() => undefined}
      />,
    );

    expect(screen.getByText('运行过程 · 已完成 1 步')).toBeInTheDocument();
    expect(screen.getByText('面试题清单')).toBeInTheDocument();
    expect(screen.getByText('请介绍项目贡献')).toBeInTheDocument();
    expect(screen.queryByText('选择维度')).not.toBeInTheDocument();
  });
});
