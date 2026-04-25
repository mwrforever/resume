import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, X, Tag as TagIcon } from 'lucide-react';
import type { IDimension, ISkill, ITag } from '@/types/employee';

const SKILL_TYPE_OPTIONS = [
  { value: 1, label: '必须满足', cls: 'bg-red-100 text-red-700' },
  { value: 2, label: '优先匹配', cls: 'bg-yellow-100 text-yellow-700' },
  { value: 3, label: '普通技能', cls: 'bg-[#F1F5F9] text-[#64748B]' },
];

const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };

export default function EmployeeJobEdit() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  useEffect(() => {
    const load = async () => {
      try {
        const [jobRes, dimRes, skillRes, tagRes, allTagRes] = await Promise.all([
          employeeJobsApi.get(jobId),
          employeeJobsApi.getDimensions(jobId),
          employeeJobsApi.getSkills(jobId),
          employeeJobsApi.getJobTags(jobId),
          employeeJobsApi.listAllTags(),
        ]);
        const job = jobRes.data?.data ?? jobRes.data;
        setName(job.name ?? '');
        setDescription(job.description ?? '');
        setStatus(job.status ?? 1);
        setDimensions(dimRes.data ?? []);
        setSkills(skillRes.data ?? []);
        const currentTagIds = (tagRes.data ?? []).map((t: ITag) => t.id);
        setSelectedTagIds(currentTagIds);
        setAllTags(allTagRes.data ?? []);
      } catch {
        setError('加载失败，请刷新重试');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [jobId]);

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

  const removeDimension = async (idx: number) => {
    const dim = dimensions[idx];
    if (dim.id) {
      try { await employeeJobsApi.deleteDimension(jobId, dim.id); } catch {}
    }
    const next = dimensions.filter((_, i) => i !== idx);
    setDimensions(autoEqualWeights(next));
  };

  const updateDimension = (idx: number, patch: Partial<IDimension>) => {
    setDimensions(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  const saveDimension = async (idx: number) => {
    const dim = dimensions[idx];
    if (!dim.dimension_name.trim()) return;
    try {
      if (dim.id) {
        const res = await employeeJobsApi.updateDimension(jobId, dim.id, dim);
        const updated = res.data?.data;
        if (updated) setDimensions(prev => prev.map((d, i) => i === idx ? { ...d, ...updated } : d));
      } else {
        const res = await employeeJobsApi.addDimension(jobId, dim);
        const created = res.data?.data;
        if (created) setDimensions(prev => prev.map((d, i) => i === idx ? { ...d, ...created } : d));
      }
    } catch {}
  };

  const equalize = () => setDimensions(autoEqualWeights(dimensions));
  const totalWeight = dimensions.reduce((s, d) => s + (d.weight || 0), 0);
  const weightOk = dimensions.length > 0 && Math.abs(totalWeight - 1) < 0.02;

  // ── Skill helpers ─────────────────────────────────────────
  const addSkill = async () => {
    if (!newSkillName.trim()) return;
    const newSkill: ISkill = { skill_name: newSkillName.trim(), skill_type: newSkillType };
    try {
      const res = await employeeJobsApi.addSkill(jobId, newSkill);
      const created = res.data?.data;
      setSkills(prev => [...prev, created ?? newSkill]);
      setNewSkillName('');
    } catch {}
  };

  const removeSkill = async (idx: number) => {
    const skill = skills[idx];
    if (skill.id) {
      try { await employeeJobsApi.deleteSkill(jobId, skill.id); } catch {}
    }
    setSkills(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await employeeJobsApi.update(jobId, { name, description, status, tag_ids: selectedTagIds });
      navigate('/employee/jobs');
    } catch {
      setError('保存失败，请重试');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '编辑岗位' }]}>
        <div className="max-w-3xl space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-white rounded-lg animate-pulse" />)}
        </div>
      </AdminLayout>
    );
  }

  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.id));
  const groupedTags = allTags.reduce<Record<number, ITag[]>>((acc, t) => {
    (acc[t.tag_type] = acc[t.tag_type] || []).push(t);
    return acc;
  }, {});

  return (
    <AdminLayout
      breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '编辑岗位' }]}
      title="编辑岗位"
    >
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">

        {/* ── 基本信息 ── */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#1E293B]">基本信息</h3>
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">岗位名称 <span className="text-red-500">*</span></Label>
              <Input id="edit-name" value={name} onChange={e => setName(e.target.value)} required autoComplete="off" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">岗位描述</Label>
              <Textarea id="edit-desc" value={description} onChange={e => setDescription(e.target.value)} className="min-h-[100px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label>招聘状态</Label>
              <div className="flex gap-3">
                {[{ v: 1, label: '招聘中', cls: 'bg-green-100 text-green-700 border-green-300' }, { v: 0, label: '已下架', cls: 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]' }].map(opt => (
                  <button key={opt.v} type="button" onClick={() => setStatus(opt.v)}
                    aria-pressed={status === opt.v}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                      status === opt.v ? opt.cls : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-[#F8FAFC]'
                    }`}>{opt.label}</button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 评估维度 ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1E293B]">
                评估维度
                <span className="ml-2 text-xs font-normal text-[#64748B]">权重合计：
                  <span className={weightOk ? 'text-green-600' : 'text-red-500'}>{totalWeight.toFixed(2)}</span>
                </span>
              </h3>
              <div className="flex gap-2">
                <button type="button" onClick={equalize} className="text-xs text-[#2563EB] hover:underline focus-visible:outline-none">均分权重</button>
                <Button type="button" size="sm" variant="outline" onClick={addDimension} className="gap-1 h-7 text-xs"><Plus size={12} />添加</Button>
              </div>
            </div>
            {dimensions.map((dim, idx) => (
              <div key={dim.id ?? `new-${idx}`} className="border border-[#E2E8F0] rounded-lg p-3 space-y-2 bg-[#FAFAFA]">
                <div className="flex items-center gap-2">
                  <Input value={dim.dimension_name}
                    onChange={e => updateDimension(idx, { dimension_name: e.target.value })}
                    onBlur={() => saveDimension(idx)}
                    placeholder="维度名称" className="h-8 flex-1 text-sm" />
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-[#64748B]">权重</span>
                    <Input type="number" step="0.01" min="0" max="1"
                      value={dim.weight}
                      onChange={e => updateDimension(idx, { weight: parseFloat(e.target.value) || 0 })}
                      onBlur={() => saveDimension(idx)}
                      className="h-8 w-20 text-sm" />
                  </div>
                  <button type="button" onClick={() => setShowPrompt(p => ({ ...p, [idx]: !p[idx] }))}
                    className="text-xs text-[#64748B] hover:text-[#2563EB] whitespace-nowrap focus-visible:outline-none">
                    {showPrompt[idx] ? '收起' : '模板'}
                  </button>
                  <button type="button" onClick={() => removeDimension(idx)}
                    aria-label="删除维度" className="text-[#94A3B8] hover:text-red-500 focus-visible:outline-none">
                    <X size={14} />
                  </button>
                </div>
                {showPrompt[idx] && (
                  <Textarea value={dim.prompt_template}
                    onChange={e => updateDimension(idx, { prompt_template: e.target.value })}
                    onBlur={() => saveDimension(idx)}
                    placeholder="留空则使用默认模板。可用 {resume_text} {job_name} 占位符"
                    className="min-h-[80px] resize-none text-xs font-mono" />
                )}
              </div>
            ))}
            {dimensions.length === 0 && <p className="text-xs text-[#94A3B8]">尚无维度</p>}
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
                disabled={!newSkillName.trim()} className="gap-1 h-8 text-xs"><Plus size={12} />添加</Button>
            </div>
            {skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {skills.map((s, idx) => {
                  const opt = SKILL_TYPE_OPTIONS.find(o => o.value === s.skill_type) ?? SKILL_TYPE_OPTIONS[2];
                  return (
                    <span key={s.id ?? idx} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${opt.cls}`}>
                      {s.skill_name}<span className="opacity-60">·{opt.label}</span>
                      <button type="button" onClick={() => removeSkill(idx)}
                        className="hover:opacity-80 focus-visible:outline-none" aria-label={`删除 ${s.skill_name}`}>
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : <p className="text-xs text-[#94A3B8]">尚无技能</p>}
          </CardContent>
        </Card>

        {/* ── 岗位 Tag ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1E293B]">岗位标签</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setTagModalOpen(true)} className="gap-1 h-7 text-xs">
                <TagIcon size={12} />选择标签
              </Button>
            </div>
            {selectedTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedTags.map(t => (
                  <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                    {t.tag_name}
                    <button type="button" onClick={() => setSelectedTagIds(ids => ids.filter(i => i !== t.id))}
                      className="hover:opacity-70 focus-visible:outline-none" aria-label={`移除 ${t.tag_name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : <p className="text-xs text-[#94A3B8]">尚无标签</p>}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-500" aria-live="polite">{error}</p>}
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/employee/jobs')} disabled={saving}>取消</Button>
          <Button type="submit" disabled={saving || !name.trim()} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            {saving ? <><Loader2 size={15} className="animate-spin mr-1.5" />保存中…</> : '保存修改'}
          </Button>
        </div>
      </form>

      {/* ── Tag 弹窗 ── */}
      {tagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTagModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[#1E293B]">选择岗位标签</h3>
              <button onClick={() => setTagModalOpen(false)} className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
            </div>
            <div className="space-y-4 max-h-80 overflow-y-auto">
              {Object.entries(groupedTags).map(([type, tags]) => (
                <div key={type}>
                  <p className="text-xs text-[#64748B] mb-2">{TAG_TYPE_LABEL[Number(type)] ?? `类型${type}`}</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map(t => {
                      const sel = selectedTagIds.includes(t.id);
                      return (
                        <button key={t.id} type="button"
                          onClick={() => setSelectedTagIds(ids => sel ? ids.filter(i => i !== t.id) : [...ids, t.id])}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none ${
                            sel ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB]'
                          }`}>{t.tag_name}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {allTags.length === 0 && <p className="text-sm text-[#94A3B8] text-center py-4">暂无可用标签</p>}
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setTagModalOpen(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">确认（已选 {selectedTagIds.length}）</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
