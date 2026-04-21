import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { userJobsApi } from '@/api/user/jobs';

interface Job {
  id: number;
  name: string;
  description: string;
  status: number;
  create_time: string;
  skills: string[];
}

export default function UserJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<HTMLDivElement>(null);

  const loadJobs = async (pageNum: number = 1, append: boolean = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await userJobsApi.list({ page: pageNum, page_size: 12 });
      const newItems = res.data.items || [];
      if (append) {
        setJobs(prev => [...prev, ...newItems]);
      } else {
        setJobs(newItems);
      }
      setHasMore(newItems.length === 12);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadJobs(nextPage, true);
    }
  }, [loadingMore, hasMore, page]);

  useEffect(() => {
    loadJobs(1);
  }, []);

  useEffect(() => {
    if (!observerRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && hasMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [loadMore, loadingMore, hasMore]);

  return (
    <PageLayout
      title="招聘岗位"
      subtitle="发现适合你的机会"
      action={<UserNav />}
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium mb-2">暂无岗位</h3>
          <p className="text-muted-foreground">暂时没有在招的岗位，请稍后再来</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job) => (
              <Link
                key={job.id}
                to={`/user/jobs/${job.id}`}
                className="group block"
              >
                <div className="bg-card rounded-xl border border-border p-6 transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-accent/5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-1">
                      <h3 className="font-semibold text-lg group-hover:text-accent transition-colors">
                        {job.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        发布时间 {job.create_time?.split('T')[0]}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                      招聘中
                    </span>
                  </div>
                  {job.skills && job.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {job.skills.map((skill, idx) => (
                        <span key={idx} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center text-sm text-accent font-medium">
                    查看详情
                    <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* 滚动加载触发器 */}
          <div ref={observerRef} className="h-4 mt-4">
            {loadingMore && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!hasMore && jobs.length > 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">
                已加载全部岗位
              </p>
            )}
          </div>
        </>
      )}
    </PageLayout>
  );
}
