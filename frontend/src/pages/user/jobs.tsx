import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { Button } from '@/components/ui/button';
import { userJobsApi } from '@/api/user/jobs';

interface Job {
  id: number;
  name: string;
  description: string;
  status: number;
  create_time: string;
  skills: string[];
}

const PAGE_SIZE = 15;

export default function UserJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const initializedRef = useRef(false);

  const loadJobs = useCallback(async (pageNum: number, append: boolean) => {
    if (append) {
      if (loadingMoreRef.current) return;
      setLoadingMore(true);
      loadingMoreRef.current = true;
    } else {
      setLoading(true);
    }
    try {
      const res = await userJobsApi.list({ page: pageNum, page_size: PAGE_SIZE });
      const newItems = res.data.items || [];
      if (append) {
        setJobs(prev => [...prev, ...newItems]);
      } else {
        setJobs(newItems);
      }
      // 返回条数小于分页大小，说明已经到底了
      const more = newItems.length === PAGE_SIZE;
      setHasMore(more);
      hasMoreRef.current = more;
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
      if (append) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, []);

  const handleLoadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    loadJobs(nextPage, true);
  }, [loadJobs]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    loadJobs(1, false);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (loadingMoreRef.current || !hasMoreRef.current) return;
      const scrollTop = window.scrollY;
      const clientHeight = window.innerHeight;
      const scrollHeight = document.documentElement.scrollHeight;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        handleLoadMore();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleLoadMore]);

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
        <div className="pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job) => (
              <Link
                key={job.id}
                to={`/user/jobs/${job.id}`}
                className="group block"
              >
                <div className="bg-card rounded-xl border border-border p-6 transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-accent/5 h-[180px] flex flex-col">
                  <div className="flex items-start justify-between mb-2 shrink-0">
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
                    <div className="flex flex-wrap gap-1.5 mb-2 shrink-0 overflow-hidden">
                      {job.skills.map((skill, idx) => (
                        <span key={idx} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center text-sm text-accent font-medium mt-auto">
                    查看详情
                    <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="py-6 flex flex-col items-center gap-4">
            {loadingMore && (
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">加载中...</span>
              </div>
            )}
            {!hasMore && jobs.length > 0 && (
              <p className="text-center text-sm text-muted-foreground">
                已经到底了哦 ({jobs.length} 条)
              </p>
            )}
            {hasMore && !loadingMore && (
              <Button variant="outline" onClick={handleLoadMore}>
                加载更多
              </Button>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  );
}