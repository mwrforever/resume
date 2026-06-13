/**
 * AgentModelPicker：Composer 顶栏的模型选择下拉
 *
 * 职责：
 * - 懒加载 /employee/llm-model-options（首次打开时拉取）
 * - 展示当前会话已选模型，点击列表项 → PUT sessions/{id}/model 持久化
 * - 选择成功后通过 onSessionUpdate 通知上层（同步 hook 内 session 与 layout sessions）
 *
 * 不做：模型管理（创建/删除）、思考开关、流式相关逻辑。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Check } from 'lucide-react';
import { employeeAgentApi, employeeLlmApi } from '@/api/employee/agent';
import type { ILlmModelOption, WorkspaceSession } from '@/types/agent';

export interface AgentModelPickerProps {
  session: WorkspaceSession;
  onSessionUpdate: (next: WorkspaceSession) => void;
}

/** 来源标签：env / employee / dept 三类，给用户辨识模型出处 */
const SOURCE_LABEL: Record<ILlmModelOption['source'], string> = {
  env: '系统',
  employee: '个人',
  dept: '部门',
};

export function AgentModelPicker({ session, onSessionUpdate }: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ILlmModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点外部关闭浮层（保持单实例点击退出体验）
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // 首次打开时懒加载选项；之后命中缓存
  const ensureOptions = async () => {
    if (options !== null || loading) return;
    setLoading(true);
    try {
      // axios 响应拦截器已 unwrap 到 {code, message, data}，故 resp.data 即列表
      const resp = await employeeLlmApi.listOptions();
      const list = ((resp as { data?: ILlmModelOption[] }).data) ?? [];
      setOptions(list);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void ensureOptions();
  };

  const onPick = async (opt: ILlmModelOption) => {
    if (opt.model_name === session.selected_model_name) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await employeeAgentApi.selectModel(session.id, opt.model_name);
      onSessionUpdate({ ...session, selected_model_name: opt.model_name });
      setOpen(false);
    } finally {
      setSwitching(false);
    }
  };

  // 默认显示：未选模型时取列表里 source==='env' 的项作为占位（仅 UI 提示）
  const currentLabel = session.selected_model_name
    ?? options?.find(o => o.source === 'env')?.model_name
    ?? '默认模型';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={switching}
        title="切换模型"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium
                    transition-all duration-150
                    bg-[#F1F5F9] text-[#334155] hover:bg-[#E2E8F0]
                    disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {switching ? <Loader2 size={12} className="animate-spin" /> : null}
        <span className="max-w-[160px] truncate">{currentLabel}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 left-1/2 -translate-x-1/2 w-[260px]
                     rounded-lg border border-[#E2E8F0] bg-white shadow-lg
                     max-h-[280px] overflow-y-auto"
        >
          {loading && (
            <div className="px-3 py-4 text-xs text-[#64748B] flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> 加载模型列表…
            </div>
          )}
          {!loading && options && options.length === 0 && (
            <div className="px-3 py-4 text-xs text-[#64748B]">
              暂无可用模型，请先到 LLM 配置中心添加。
            </div>
          )}
          {!loading && options && options.map(opt => {
            const selected = opt.model_name === session.selected_model_name;
            return (
              <button
                key={`${opt.source}-${opt.config_id ?? 'env'}-${opt.model_name}`}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => void onPick(opt)}
                className={`w-full text-left px-3 py-2 flex items-start gap-2
                            hover:bg-[#F1F5F9] transition-colors
                            ${selected ? 'bg-[#E0F2FE]' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[#020617] truncate">
                    {opt.model_name}
                  </div>
                  <div className="text-[11px] text-[#64748B] truncate">
                    <span className="inline-block px-1.5 py-0.5 mr-1 rounded bg-[#F1F5F9] text-[#475569]">
                      {SOURCE_LABEL[opt.source] ?? opt.source}
                    </span>
                    {opt.config_name}
                  </div>
                </div>
                {selected && <Check size={14} className="text-[#0369A1] mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
