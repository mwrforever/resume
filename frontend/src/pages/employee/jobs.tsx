import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { employeeJobsApi } from '@/api/employee/jobs';

interface Job {
  id: number;
  name: string;
  description: string;
  status: number;
  create_time: string;
}

export default function EmployeeJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const res = await employeeJobsApi.list();
      setJobs(res.data.items || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个岗位吗？')) return;
    try {
      await employeeJobsApi.delete(id);
      await loadJobs();
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">岗位管理</h1>
        <Link to="/employee/jobs/create">
          <button className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700">
            创建岗位
          </button>
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          还没有创建过岗位
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-lg shadow p-4 flex justify-between items-center">
              <div>
                <p className="font-medium">{job.name}</p>
                <p className="text-sm text-gray-500">
                  {job.status === 1 ? '招聘中' : '已下架'} | {job.create_time?.split('T')[0]}
                </p>
              </div>
              <div className="flex gap-2">
                <Link to={`/employee/jobs/${job.id}/edit`}>
                  <button className="px-3 py-1 border rounded hover:bg-gray-100 text-sm">
                    编辑
                  </button>
                </Link>
                <button
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  onClick={() => handleDelete(job.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
