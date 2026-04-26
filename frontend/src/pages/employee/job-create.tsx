import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, Plus, X, Tag as TagIcon } from 'lucide-react';
import type { IDimension, ISkill, ITag } from '@/types/employee';

const SKILL_TYPE_OPTIONS = [
  { value: 1, label: '必须满足', cls: 'bg-red-100 text-red-700' },
  { value: 2, label: '优先匹配', cls: 'bg-yellow-100 text-yellow-700' },
  { value: 3, label: '普通技能', cls: 'bg-[#F1F5F9] text-[#64748B]' },
];

const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };
const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

export default function EmployeeJobCreate() {
  const navigate = useNavigate();

  // ── Basic info ──────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState(1);

  // ── Dimensions ──────────────────────────────────────────
  const [dimensions, setDimensions] = useState<IDimension[]>([]);
  const [showPrompt, setShowPrompt] = useState<Record<number, boolean>>({});

  // ── Skills ──────────────────────────────────────────────
  const [skills, setSkills] = useState<ISkill[]>([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillType, setNewSkillType] = useState(1);

  // ── Tags ────────────────────────────────────────────────
  const [allTags, setAllTags] = useState<ITag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  // ── AI / UI state ────────────────────────────────────────
  const [suggesting, setSuggesting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    employeeJobsApi.listAllTags().then(res => setAllTags(getResponseData<ITag[]>(res, [])));
    return () => {
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
    };
  }, []);

  // ── Dimension helpers ────────────────────────────────────
  const autoEqualWeights = (dims: IDimension[]): IDimension[] => {
    if (dims.length === 0) return dims;
    const w = parseFloat((1 / dims.length).toFixed(2));
    const last = parseFloat((1 - w * (dims.length - 1)).toFixed(2));
    return dims.map((d, i) => ({ ...d, weight: i === dims.length - 1 ? last : w }));
  };

  const addDimension = () => {
    const newDim: IDimension = { dimension_name: '', weight: 0, prompt_template: '', sort_order: dimensions.length };
    setDimensions(autoEqualWeights([...dimensions, newDim]));
  };

  const removeDimension = (idx: number) => {
    const next = dimensions.filter((_, i) => i !== idx);
    setDimensions(autoEqualWeights(next));
  };

  const updateDimension = (idx: number, patch: Partial<IDimension>) => {
    setDimensions(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  const equalize = () => setDimensions(autoEqualWeights(dimensions));

  const totalWeight = dimensions.reduce((s, d) => s + (d.weight || 0), 0);
  const weightOk = dimensions.length > 0 && Math.abs(totalWeight - 1) < 0.02;

  // ── Skill helpers ─────────────────────────────────────────
  const addSkill = () => {
    if (!newSkillName.trim()) return;
    setSkills(prev => [...prev, { skill_name: newSkillName.trim(), skill_type: newSkillType }]);
    setNewSkillName('');
  };

  const removeSkill = (idx: number) => setSkills(prev => prev.filter((_, i) => i !== idx));

  // ── AI suggest ────────────────────────────────────────────
  const cancelAiSuggest = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setSuggesting(false);
  };

  const handleAiSuggest = async () => {
    if (!name.trim()) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setSuggesting(true);
    setAiError('');
    try {
      const res = await employeeJobsApi.aiSuggest({ name, description }, controller.signal);
      const data = getResponseData<any>(res, null);
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
          setSkills(data.skills.map((s: any) => ({
            skill_name: s.skill,
            skill_type: s.type ?? 3,
          })));
        }
      }
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') {
        setAiError('已中断 AI 生成');
        return;
      }
      setAiError('AI 生成失败，请重试');
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setSuggesting(false);
      }
    }
  };

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) return;
    if (dimensions.length === 0) { setFormError('请至少添加一个评估维度'); return; }
    if (!weightOk) { setFormError(`维度权重之和须为 1.00，当前为 ${totalWeight.toFixed(2)}`); return; }
    setSubmitting(true);
    try {
      await employeeJobsApi.create({
        name,
        description,
        dept_id: deptId,
        dimensions,
        skills,
        tag_ids: selectedTagIds,
      });
      navigate('/employee/jobs');
    } catch (err: any) {
      setFormError(err?.response?.data?.message || '创建失败，请重试');
      setSubmitting(false);
    }
  };

  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.id));
  const groupedTags = allTags.reduce<Record<number, ITag[]>>((acc, t) => {
    (acc[t.tag_type] = acc[t.tag_type] || []).push(t);
    return acc;
  }, {});

  return (
    <AdminLayout
      breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '创建岗位' }]}
      title="创建岗位（待发布）"
    >
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">

        {/* ── 基本信息 ── */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#1E293B]">基本信息</h3>

            <div className="space-y-1.5">
              <Label htmlFor="job-name">岗位名称 <span className="text-red-500">*</span></Label>
              <Input id="job-name" value={name} onChange={e => setName(e.target.value)}
                placeholder="例如：高级前端工程师" required autoComplete="off" className="h-10" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="job-desc">岗位描述</Label>
              <Textarea id="job-desc" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="简要描述岗位职责，AI 将据此生成详细内容" className="min-h-[90px] resize-none" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dept-id">部门 ID</Label>
              <Input id="dept-id" type="number" value={deptId}
                onChange={e => setDeptId(parseInt(e.target.value) || 1)} className="h-10 w-28" />
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleAiSuggest}
                disabled={!name.trim() || suggesting} className="gap-2">
                {suggesting
                  ? <><Loader2 size={14} className="animate-spin" />AI 生成中…</>
                  : <><Sparkles size={14} />AI 一键生成（描述 + 维度 + 技能）</>}
              </Button>
              {suggesting && (
                <Button type="button" variant="outline" onClick={cancelAiSuggest}>
                  中断
                </Button>
              )}
            </div>
            {aiError && <p className="text-xs text-red-500">{aiError}</p>}
          </CardContent>
        </Card>

        {/* ── 评估维度 ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1E293B]">
                评估维度 <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-[#64748B]">权重合计：
                  <span className={weightOk ? 'text-green-600' : 'text-red-500'}>{totalWeight.toFixed(2)}</span>
                </span>
              </h3>
              <div className="flex gap-2">
                <button type="button" onClick={equalize}
                  className="text-xs text-[#2563EB] hover:underline focus-visible:outline-none">均分权重</button>
                <Button type="button" size="sm" variant="outline" onClick={addDimension} className="gap-1 h-7 text-xs">
                  <Plus size={12} />添加维度
                </Button>
              </div>
            </div>

            {dimensions.length === 0 && (
              <p className="text-xs text-[#94A3B8] py-2">尚未添加评估维度，请点击「添加维度」或使用 AI 一键生成</p>
            )}

            {dimensions.map((dim, idx) => (
              <div key={idx} className="border border-[#E2E8F0] rounded-lg p-3 space-y-2 bg-[#FAFAFA]">
                <div className="flex items-center gap-2">
                  <Input value={dim.dimension_name}
                    onChange={e => updateDimension(idx, { dimension_name: e.target.value })}
                    placeholder="维度名称（如：技术能力）" className="h-8 flex-1 text-sm" />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-[#64748B]">权重</span>
                    <Input type="number" step="0.01" min="0" max="1"
                      value={dim.weight}
                      onChange={e => updateDimension(idx, { weight: parseFloat(e.target.value) || 0 })}
                      className="h-8 w-20 text-sm" />
                  </div>
                  <button type="button" onClick={() => setShowPrompt(p => ({ ...p, [idx]: !p[idx] }))}
                    className="text-xs text-[#64748B] hover:text-[#2563EB] whitespace-nowrap focus-visible:outline-none">
                    {showPrompt[idx] ? '收起模板' : '展开模板'}
                  </button>
                  <button type="button" onClick={() => removeDimension(idx)}
                    aria-label="删除维度" className="text-[#94A3B8] hover:text-red-500 focus-visible:outline-none">
                    <X size={14} />
                  </button>
                </div>
                {showPrompt[idx] && (
                  <Textarea value={dim.prompt_template}
                    onChange={e => updateDimension(idx, { prompt_template: e.target.value })}
                    placeholder="留空则使用默认评估模板。可使用 {resume_text} 和 {job_name} 占位符自定义"
                    className="min-h-[80px] resize-none text-xs font-mono" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── 技能关联 ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[#1E293B]">技能关联</h3>

            <div className="flex gap-2">
              <Input value={newSkillName} onChange={e => setNewSkillName(e.target.value)}
                placeholder="技能名称" className="h-8 flex-1 text-sm"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill())} />
              <select value={newSkillType} onChange={e => setNewSkillType(Number(e.target.value))}
                className="h-8 border border-[#E2E8F0] rounded-md text-sm px-2 bg-white">
                {SKILL_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={addSkill}
                disabled={!newSkillName.trim()} className="gap-1 h-8 text-xs">
                <Plus size={12} />添加
              </Button>
            </div>

            {skills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {skills.map((s, idx) => {
                  const opt = SKILL_TYPE_OPTIONS.find(o => o.value === s.skill_type) ?? SKILL_TYPE_OPTIONS[2];
                  return (
                    <span key={idx} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${opt.cls}`}>
                      {s.skill_name}
                      <span className="opacity-60">·{opt.label}</span>
                      <button type="button" onClick={() => removeSkill(idx)}
                        className="hover:opacity-80 focus-visible:outline-none" aria-label={`删除技能 ${s.skill_name}`}>
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {skills.length === 0 && <p className="text-xs text-[#94A3B8]">尚未添加技能</p>}
          </CardContent>
        </Card>

        {/* ── 岗位 Tag ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1E293B]">岗位标签</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setTagModalOpen(true)}
                className="gap-1 h-7 text-xs">
                <TagIcon size={12} />选择标签
              </Button>
            </div>
            {selectedTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedTags.map(t => (
                  <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                    {t.tag_name}
                    <button type="button" onClick={() => setSelectedTagIds(ids => ids.filter(i => i !== t.id))}
                      className="hover:opacity-70 focus-visible:outline-none" aria-label={`移除标签 ${t.tag_name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : <p className="text-xs text-[#94A3B8]">尚未选择标签</p>}
          </CardContent>
        </Card>

        {/* ── Submit ── */}
        {formError && <p className="text-sm text-red-500" aria-live="polite">{formError}</p>}
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/employee/jobs')}
            disabled={submitting}>取消</Button>
          <Button type="submit" disabled={submitting || !name.trim()}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            {submitting ? <><Loader2 size={14} className="animate-spin mr-1.5" />创建中…</> : '创建岗位'}
          </Button>
        </div>
      </form>

      {/* ── Tag 选择弹窗 ── */}
      {tagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTagModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1E293B]">选择岗位标签</h3>
              <button onClick={() => setTagModalOpen(false)}
                className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 max-h-80 overflow-y-auto">
              {Object.entries(groupedTags).map(([type, tags]) => (
                <div key={type}>
                  <p className="text-xs text-[#64748B] mb-2">{TAG_TYPE_LABEL[Number(type)] ?? `类型${type}`}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(t => {
                      const selected = selectedTagIds.includes(t.id);
                      return (
                        <button key={t.id} type="button"
                          onClick={() => setSelectedTagIds(ids =>
                            selected ? ids.filter(i => i !== t.id) : [...ids, t.id]
                          )}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none ${
                            selected
                              ? 'bg-[#2563EB] text-white border-[#2563EB]'
                              : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB]'
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
              <Button onClick={() => setTagModalOpen(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
                确认（已选 {selectedTagIds.length}）
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
