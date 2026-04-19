import { useEffect, useState } from 'react';
import { userResumesApi } from '@/api/user/resumes';

interface Resume {
  id: number;
  file_name: string;
  status: number;
  create_time: string;
}

export default function UserMyResumes() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadResumes = async () => {
    const res = await userResumesApi.list();
    setResumes(res.data.items || []);
  };

  useEffect(() => {
    loadResumes();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await userResumesApi.upload(file);
      await loadResumes();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这份简历吗？')) return;
    try {
      await userResumesApi.delete(id);
      await loadResumes();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">我的附件简历</h1>
        <div>
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
            id="resume-upload"
          />
          <label htmlFor="resume-upload">
            <button
              type="button"
              disabled={uploading}
              className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? '上传中...' : '上传简历'}
            </button>
          </label>
        </div>
      </div>

      {resumes.length === 0 ? (
        <div className="bg-card rounded-lg shadow p-12 text-center text-secondary">
          还没有上传过简历
        </div>
      ) : (
        <div className="space-y-4">
          {resumes.map((resume) => (
            <div key={resume.id} className="bg-card rounded-lg shadow p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{resume.file_name}</p>
                  <p className="text-sm text-secondary">
                    上传时间: {resume.create_time}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => window.open(`/files/${resume.file_path}`)}
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
                  >
                    查看
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(resume.id)}
                    className="px-3 py-1 bg-danger text-white rounded-md text-sm hover:bg-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}