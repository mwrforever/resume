import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface SkillSuggestItem {
  skill: string;
  type: number;
  reason: string;
}

export default function EmployeeJobCreate() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState(1);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<SkillSuggestItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSuggest = async () => {
    if (!name.trim()) return;
    setSuggesting(true);
    try {
      const res = await employeeJobsApi.suggestSkills({ name, description });
      setSuggestions(res.data || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
    } finally {
      setSuggesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await employeeJobsApi.create({ name, description, dept_id: deptId });
      navigate('/employee/jobs');
    } catch (error) {
      console.error('Failed to create job:', error);
      setLoading(false);
    }
  };

  return (
    <PageLayout
      title="创建岗位"
      subtitle="发布新的招聘信息"
      action={<EmployeeNav />}
    >
      <div className="max-w-2xl">
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">岗位名称</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：高级前端工程师"
                  required
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">岗位描述</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述岗位职责、要求等..."
                  className="min-h-[120px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deptId">部门ID</Label>
                <Input
                  id="deptId"
                  type="number"
                  value={deptId}
                  onChange={(e) => setDeptId(parseInt(e.target.value) || 1)}
                  className="h-11 w-32"
                />
              </div>

              <div className="flex gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSuggest}
                  disabled={!name.trim() || suggesting}
                >
                  {suggesting ? '生成中...' : 'AI生成技能建议'}
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !name.trim()}
                >
                  {loading ? '创建中...' : '创建岗位'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {showSuggestions && suggestions.length > 0 && (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <h3 className="text-lg font-semibold mb-4">AI技能建议</h3>
              <div className="space-y-3">
                {suggestions.map((item, idx) => (
                  <div key={idx} className="p-4 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.skill}</span>
                      <span className={`text-xs px-2 py-1 rounded ${
                        item.type === 1 ? 'bg-red-100 text-red-700' :
                        item.type === 2 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-200 text-gray-700'
                      }`}>
                        {item.type === 1 ? '必须' : item.type === 2 ? '优先' : '普通'}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{item.reason}</p>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                className="mt-4"
                onClick={() => setShowSuggestions(false)}
              >
                关闭
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
