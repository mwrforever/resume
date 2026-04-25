import { useEffect, useRef, useState } from 'react';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, Plus, X, Tag as TagIcon, ChevronDown } from 'lucide-react';
import type { IDimension, ISkill, ITag } from '@/types/employee';

interface Dept { id: number; dept_name: string; dept_code?: string }

const SKILL_TYPE_OPTIONS = [
  { value: 1, label: '必须满足', cls: 'bg-red-100 text-red-700' },
  { value: 2, label: '优先匹配', cls: 'bg-yellow-100 text-yellow-700' },
  { value: 3, label: '普通技能', cls: 'bg-[#F1F5F9] text-[#64748B]' },
];
const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };

interface CreateJobModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateJobModal({ open, onClose, onSuccess }: CreateJobModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [deptOpen, setDeptOpen] = useState(false);
  const deptRef = useRef<HTMLDivElement>(null);

  const [dimensions, setDimensions] = useState<IDimension[]>([]);
  const [showPrompt, setShowPrompt] = useState<Record<number, boolean>>({});
  const [skills, setSkills] = useState<ISkill[]>([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillType, setNewSkillType] = useState(1);
  const [allTags, setAllTags] = useState<ITag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const [suggesting, setSuggesting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Load static data once on open
  useEffect(() => {
    if (!open) return;
    employeeJobsApi.listDepts().then(res => {
      const list: Dept[] = res.data?.data ?? [];
      setDepts(list);
      if (list.length > 0 && deptId === null) setDeptId(list[0].id);
    });
    employeeJobsApi.listAllTags().then(res => setAllTags(res.data?.data ?? []));
  }, [open]);

  // Reset form on close
  useEffect(() => {
    if (!open) {
      setName(''); setDescription(''); setDeptId(null);
      setDimensions([]); setSkills([]); setSelectedTagIds([]);
      setShowPrompt({}); setAiError(''); setFormError('');
      setNewSkillName(''); setNewSkillType(1);
    }
  }, [open]);

  // Close dept dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Dimension helpers ───────────────────────────────────────────────────────
  const autoEqualWeights = (dims: IDimension[]): IDimension[] => {
    if (dims.length === 0) return dims;
    const w = parseFloat((1 / dims.length).toFixed(2));
    const last = parseFloat((1 - w * (dims.length - 1)).toFixed(2));
    return dims.map((d, i) => ({ ...d, weight: i === dims.length - 1 ? last : w }));
  };
  const addDimension = () => setDimensions(prev => autoEqualWeights([...prev, { dimension_name: '', weight: 0, prompt_template: '', sort_order: prev.length }]));
  const removeDimension = (idx: number) => setDimensions(prev => autoEqualWeights(prev.filter((_, i) => i !== idx)));
  const updateDimension = (idx: number, patch: Partial<IDimension>) =>
    setDimensions(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  const equalize = () => setDimensions(autoEqualWeights(dimensions));
  const totalWeight = dimensions.reduce((s, d) => s + (d.weight || 0), 0);
  const weightOk = dimensions.length > 0 && Math.abs(totalWeight - 1) < 0.02;

  // ── Skill helpers ───────────────────────────────────────────────────────────
  const addSkill = () => {
    if (!newSkillName.trim()) return;
    setSkills(prev => [...prev, { skill_name: newSkillName.trim(), skill_type: newSkillType }]);
    setNewSkillName('');
  };

  // ── AI suggest ──────────────────────────────────────────────────────────────
  const handleAiSuggest = async () => {
    if (!name.trim()) return;
    setSuggesting(true); setAiError('');
    try {
      const res = await employeeJobsApi.aiSuggest({ name, description });
      const data = res.data?.data;
      if (data) {
        if (data.comprehensive_description) setDescription(data.comprehensive_description);
        if (data.dimensions?.length) {
          setDimensions(data.dimensions.map((d: any, i: number) => ({
            dimension_name: d.dimension_name,
            weight: d.weight,
            prompt_template: d.prompt_template || '',
            sort_order: i,
          })));
        }
        if (data.skills?.length) {
          setSkills(data.skills.map((s: any) => ({ skill_name: s.skill, skill_type: s.type ?? 3 })));
        }
      }
    } catch {
      setAiError('AI 生成失败，请重试');
    } finally {
      setSuggesting(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) return;
    if (!deptId) { setFormError('请选择部门'); return; }
    if (dimensions.length === 0) { setFormError('请至少添加一个评估维度'); return; }
    if (!weightOk) { setFormError(`维度权重之和须为 1.00，当前为 ${totalWeight.toFixed(2)}`); return; }
    setSubmitting(true);
    try {
      await employeeJobsApi.create({ name, description, dept_id: deptId, dimensions, skills, tag_ids: selectedTagIds });
      onSuccess();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || '创建失败，请重试');
      setSubmitting(false);
    }
  };

  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.id));
  const groupedTags = allTags.reduce<Record<number, ITag[]>>((acc, t) => {
    (acc[t.tag_type] = acc[t.tag_type] || []).push(t); return acc;
  }, {});
  const selectedDept = depts.find(d => d.id === deptId);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] flex-shrink-0">
          <h2 className="text-base font-semibold text-[#1E293B]">发布岗位</h2>
          <button onClick={onClose} aria-label="关闭"
            className="text-[#94A3B8] hover:text-[#1E293B] transition-colors focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <form id="create-job-form" onSubmit={handleSubmit} className="space-y-5">

            {/* ── 基本信息 ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">基本信息</p>

              <div className="space-y-1.5">
                <Label htmlFor="cjm-name">岗位名称 <span className="text-red-500">*</span></Label>
                <Input id="cjm-name" value={name} onChange={e => setName(e.target.value)}
                  placeholder="例如：高级前端工程师" required autoComplete="off" className="h-9" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cjm-desc">岗位描述</Label>
                <Textarea id="cjm-desc" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="简要描述岗位职责，AI 将据此生成详细内容" className="min-h-[80px] resize-none text-sm" />
              </div>

              {/* Dept dropdown */}
              <div className="space-y-1.5">
                <Label>所属部门 <span className="text-red-500">*</span></Label>
                <div className="relative" ref={deptRef}>
                  <button type="button" onClick={() => setDeptOpen(v => !v)}
                    className="w-full h-9 px-3 flex items-center justify-between border border-[#E2E8F0] rounded-md text-sm bg-white hover:border-[#2563EB] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
                    <span className={selectedDept ? 'text-[#1E293B]' : 'text-[#94A3B8]'}>
                      {selectedDept
                        ? <>{selectedDept.dept_name}{selectedDept.dept_code && <span className="ml-1.5 text-xs text-[#94A3B8]">({selectedDept.dept_code})</span>}</>
                        : '请选择部门'}
                    </span>
                    <ChevronDown size={14} className={`text-[#94A3B8] transition-transform ${deptOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {deptOpen && (
                    <div className="absolute top-10 left-0 right-0 z-10 bg-white border border-[#E2E8F0] rounded-md shadow-lg max-h-44 overflow-y-auto">
                      {depts.length === 0
                        ? <p className="px-3 py-2 text-sm text-[#94A3B8]">暂无部门数据</p>
                        : depts.map(d => (
                          <button key={d.id} type="button"
                            onClick={() => { setDeptId(d.id); setDeptOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-[#F8FAFC] transition-colors ${deptId === d.id ? 'bg-blue-50 text-[#2563EB] font-medium' : 'text-[#1E293B]'}`}>
                            {d.dept_name}
                            {d.dept_code && <span className="ml-1.5 text-xs text-[#94A3B8]">({d.dept_code})</span>}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>

              <Button type="button" variant="outline" onClick={handleAiSuggest}
                disabled={!name.trim() || suggesting} className="gap-2 h-8 text-xs">
                {suggesting
                  ? <><Loader2 size={13} className="animate-spin" />AI 生成中…</>
                  : <><Sparkles size={13} />AI 一键生成（描述 + 维度 + 技能）</>}
              </Button>
              {aiError && <p className="text-xs text-red-500">{aiError}</p>}
            </div>

            {/* ── 评估维度 ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">
                  评估维度 <span className="text-red-500">*</span>
                  <span className="ml-2 font-normal normal-case">
                    权重合计：<span className={weightOk ? 'text-green-600' : 'text-red-500'}>{totalWeight.toFixed(2)}</span>
                  </span>
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={equalize} className="text-xs text-[#2563EB] hover:underline focus-visible:outline-none">均分</button>
                  <Button type="button" size="sm" variant="outline" onClick={addDimension} className="h-6 text-xs gap-1 px-2">
                    <Plus size={11} />添加
                  </Button>
                </div>
              </div>
              {dimensions.length === 0
                ? <p className="text-xs text-[#94A3B8] py-1">尚未添加评估维度，点击「添加」或使用 AI 一键生成</p>
                : dimensions.map((dim, idx) => (
                  <div key={idx} className="border border-[#E2E8F0] rounded-lg p-3 space-y-2 bg-[#FAFAFA]">
                    <div className="flex items-center gap-2">
                      <Input value={dim.dimension_name}
                        onChange={e => updateDimension(idx, { dimension_name: e.target.value })}
                        placeholder="维度名称（如：技术能力）" className="h-7 flex-1 text-sm" />
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-[#64748B]">权重</span>
                        <Input type="number" step="0.01" min="0" max="1"
                          value={dim.weight}
                          onChange={e => updateDimension(idx, { weight: parseFloat(e.target.value) || 0 })}
                          className="h-7 w-16 text-xs" />
                      </div>
                      <button type="button" onClick={() => setShowPrompt(p => ({ ...p, [idx]: !p[idx] }))}
                        className="text-xs text-[#94A3B8] hover:text-[#2563EB] whitespace-nowrap focus-visible:outline-none">
                        {showPrompt[idx] ? '收起' : '模板'}
                      </button>
                      <button type="button" onClick={() => removeDimension(idx)}
                        className="text-[#94A3B8] hover:text-red-500 focus-visible:outline-none">
                        <X size={13} />
                      </button>
                    </div>
                    {showPrompt[idx] && (
                      <Textarea value={dim.prompt_template}
                        onChange={e => updateDimension(idx, { prompt_template: e.target.value })}
                        placeholder="留空使用默认模板。可用占位符：{resume_text}、{job_name}"
                        className="min-h-[64px] resize-none text-xs font-mono" />
                    )}
                  </div>
                ))
              }
            </div>

            {/* ── 技能关联 ── */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">技能关联</p>
              <div className="flex gap-2">
                <Input value={newSkillName} onChange={e => setNewSkillName(e.target.value)}
                  placeholder="技能名称" className="h-8 flex-1 text-sm"
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill())} />
                <select value={newSkillType} onChange={e => setNewSkillType(Number(e.target.value))}
                  className="h-8 border border-[#E2E8F0] rounded-md text-xs px-2 bg-white text-[#475569]">
                  {SKILL_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <Button type="button" size="sm" variant="outline" onClick={addSkill}
                  disabled={!newSkillName.trim()} className="h-8 text-xs gap-1 px-3">
                  <Plus size={11} />添加
                </Button>
              </div>
              {skills.length > 0
                ? <div className="flex flex-wrap gap-1.5">
                    {skills.map((s, idx) => {
                      const opt = SKILL_TYPE_OPTIONS.find(o => o.value === s.skill_type) ?? SKILL_TYPE_OPTIONS[2];
                      return (
                        <span key={idx} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${opt.cls}`}>
                          {s.skill_name}<span className="opacity-60">·{opt.label}</span>
                          <button type="button" onClick={() => setSkills(prev => prev.filter((_, i) => i !== idx))}
                            className="hover:opacity-80 focus-visible:outline-none"><X size={10} /></button>
                        </span>
                      );
                    })}
                  </div>
                : <p className="text-xs text-[#94A3B8]">尚未添加技能</p>
              }
            </div>

            {/* ── 岗位标签 ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">岗位标签</p>
                <Button type="button" size="sm" variant="outline" onClick={() => setTagModalOpen(true)}
                  className="h-6 text-xs gap-1 px-2">
                  <TagIcon size={11} />选择标签
                </Button>
              </div>
              {selectedTags.length > 0
                ? <div className="flex flex-wrap gap-1.5">
                    {selectedTags.map(t => (
                      <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                        {t.tag_name}
                        <button type="button" onClick={() => setSelectedTagIds(ids => ids.filter(i => i !== t.id))}
                          className="hover:opacity-70 focus-visible:outline-none"><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                : <p className="text-xs text-[#94A3B8]">尚未选择标签</p>
              }
            </div>

            {formError && <p className="text-sm text-red-500" aria-live="polite">{formError}</p>}
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E2E8F0] flex-shrink-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button type="submit" form="create-job-form" disabled={submitting || !name.trim()}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            {submitting ? <><Loader2 size={13} className="animate-spin mr-1.5" />创建中…</> : '创建岗位'}
          </Button>
        </div>
      </div>

      {/* ── Tag picker nested modal ── */}
      {tagModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => setTagModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1E293B] text-sm">选择岗位标签</h3>
              <button onClick={() => setTagModalOpen(false)} className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 max-h-72 overflow-y-auto">
              {Object.entries(groupedTags).map(([type, tags]) => (
                <div key={type}>
                  <p className="text-xs text-[#64748B] mb-2 font-medium">{TAG_TYPE_LABEL[Number(type)] ?? `类型${type}`}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(t => {
                      const selected = selectedTagIds.includes(t.id);
                      return (
                        <button key={t.id} type="button"
                          onClick={() => setSelectedTagIds(ids => selected ? ids.filter(i => i !== t.id) : [...ids, t.id])}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none ${
                            selected ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB]'
                          }`}>
                          {t.tag_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {allTags.length === 0 && <p className="text-sm text-[#94A3B8] text-center py-4">暂无可用标签</p>}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setTagModalOpen(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm">
                确认（已选 {selectedTagIds.length}）
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
