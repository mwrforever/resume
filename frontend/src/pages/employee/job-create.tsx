import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeeJobsApi } from '@/api/employee/jobs';

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
  const [suggestions, setSuggestions] = useState<SkillSuggestItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSuggest = async () => {
    if (!name.trim()) return;
    try {
      const res = await employeeJobsApi.suggestSkills({ name, description });
      setSuggestions(res.data || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Failed to get suggestions:', error);
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
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">创建岗位</h1>

      <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">岗位名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例如：高级前端工程师"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">岗位描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 h-32"
            placeholder="描述岗位职责、要求等..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">部门ID</label>
          <input
            type="number"
            value={deptId}
            onChange={(e) => setDeptId(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={handleSuggest}
            className="px-4 py-2 border rounded hover:bg-gray-100"
            disabled={!name.trim()}
          >
            AI生成技能建议
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
            disabled={loading || !name.trim()}
          >
            {loading ? '创建中...' : '创建岗位'}
          </button>
        </div>
      </form>

      {showSuggestions && suggestions.length > 0 && (
        <div className="mt-8 max-w-xl">
          <h2 className="text-lg font-semibold mb-4">AI技能建议</h2>
          <div className="space-y-3">
            {suggestions.map((item, idx) => (
              <div key={idx} className="bg-gray-50 p-4 rounded">
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
                <p className="text-sm text-gray-600 mt-1">{item.reason}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowSuggestions(false)}
            className="mt-4 text-sm text-gray-500 hover:text-gray-700"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
