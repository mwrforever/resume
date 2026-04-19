import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { userJobsApi } from '@/api/user/jobs';

interface Job {
  id: number;
  name: string;
  description: string;
  status: number;
  create_time: string;
}

export default function UserJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadJobs = async (pageNum: number = 1) => {
    setLoading(true);
    try {
      const res = await userJobsApi.list({ page: pageNum, page_size: 20 });
      setJobs(res.data.items || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs(page);
  }, [page]);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">招聘岗位</h1>

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          暂无可投递的岗位
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-2">{job.name}</h3>
              <p className="text-sm text-gray-500 mb-4">
                发布时间: {job.create_time?.split('T')[0]}
              </p>
              <p className="text-sm text-gray-600 line-clamp-3 mb-4">
                {job.description || "暂无岗位描述"}
              </p>
              <Link to={`/user/jobs/${job.id}`}>
                <button className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700">
                  查看详情
                </button>
              </Link>
            </div>
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            className="px-4 py-2 border rounded hover:bg-gray-100"
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="py-2 px-4">第 {page} 页</span>
          <button
            className="px-4 py-2 border rounded hover:bg-gray-100"
            onClick={() => setPage(p => p + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
