import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MatchDistribution } from '@/types/employee';

interface MatchPieChartProps {
  data: MatchDistribution;
}

const COLORS = {
  excellent: '#10B981',  // 绿色
  good: '#2563EB',        // 蓝色
  average: '#F59E0B',     // 黄色
  fail: '#EF4444',        // 红色
};

export function MatchPieChart({ data }: MatchPieChartProps) {
  const chartData = [
    { name: '优秀', count: data.excellent.count, percentage: data.excellent.percentage, color: COLORS.excellent },
    { name: '良好', count: data.good.count, percentage: data.good.percentage, color: COLORS.good },
    { name: '一般', count: data.average.count, percentage: data.average.percentage, color: COLORS.average },
    { name: '未达标', count: data.fail.count, percentage: data.fail.percentage, color: COLORS.fail },
  ];
  const passedCount = data.excellent.count + data.good.count;
  const passedPercentage = data.total > 0 ? Math.round((passedCount / data.total) * 100) : 0;

  if (data.total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-[#E2E8F0] text-sm text-muted-foreground">
        暂无评估数据
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[#F8FAFC] p-3">
          <p className="text-xs text-[#64748B]">已评估</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#1E293B]">{data.total}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700">优秀/良好占比</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{passedPercentage}%</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis dataKey="name" type="category" width={48} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
          <Tooltip formatter={(value, _name, item) => {
            const payload = item.payload as { count: number; name: string };
            return [`${payload.count}份（${value ?? 0}%）`, payload.name];
          }} />
          <Bar dataKey="percentage" radius={[0, 6, 6, 0]} barSize={18} background={{ fill: '#F1F5F9', radius: 6 }}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 space-y-2">
        {chartData.map((item) => (
          <div key={item.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-[#64748B]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <span className="tabular-nums text-[#1E293B]">{item.count} 份 / {item.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}