import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, CalendarDays, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { userJobsApi } from '@/api/user/jobs';
import { EmptyState, PageSkeleton, SkillPill, StatusPill } from '@/components/user/user-ui';
import { UserShell } from '@/components/user/user-shell';
import { useThrottleCallback } from '@/hooks/use-debounce';

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

  const handleLoadMore = useThrottleCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    loadJobs(nextPage, true);
  });

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
    <UserShell
      title="招聘岗位"
      subtitle="浏览开放岗位，查看技能要求，并选择合适的简历完成投递。"
      eyebrow="Job Marketplace"
      action={
        <div className="rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent">
          <span className="font-semibold tabular-nums">{jobs.length}</span> 个岗位已加载
        </div>
      }
    >
      {loading ? (
        <PageSkeleton rows={6} />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="暂无岗位"
          description="暂时没有在招岗位，请稍后再来查看新的机会。"
          icon={<Briefcase className="h-8 w-8" aria-hidden="true" />}
        />
      ) : (
        <div className="pb-6">
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border/80 bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <Search className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <p>点击岗位卡片可查看详情并选择附件简历进行投递。</p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <Link
                key={job.id}
                to={`/user/jobs/${job.id}`}
                className="group block rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <article className="flex min-h-[15rem] flex-col rounded-3xl border border-border/80 bg-white p-6 shadow-sm shadow-slate-200/60 [content-visibility:auto] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg hover:shadow-accent/10">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                      <h2 className="line-clamp-2 text-xl font-semibold leading-7 text-foreground transition-colors group-hover:text-accent">
                        {job.name}
                      </h2>
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" aria-hidden="true" />
                        发布时间 {job.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(job.create_time)) : '-'}
                      </p>
                    </div>
                    <StatusPill className="shrink-0 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      招聘中
                    </StatusPill>
                  </div>
                  {job.skills && job.skills.length > 0 && (
                    <div className="mb-5 flex max-h-16 flex-wrap gap-2 overflow-hidden">
                      {job.skills.slice(0, 6).map((skill, idx) => (
                        <SkillPill key={`${job.id}-${skill}-${idx}`}>
                          {skill}
                        </SkillPill>
                      ))}
                      {job.skills.length > 6 ? <SkillPill>+{job.skills.length - 6}</SkillPill> : null}
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-between border-t border-border/70 pt-4 text-sm">
                    <span className="text-muted-foreground">岗位 ID #{job.id}</span>
                    <span className="inline-flex items-center font-semibold text-accent">
                    查看详情
                      <ArrowRight className="ml-1 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                    </span>
                  </div>
                </article>
              </Link>
            ))}
          </div>

          <div className="flex flex-col items-center gap-4 py-8" aria-live="polite">
            {loadingMore && (
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">加载中…</span>
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
    </UserShell>
  );
}