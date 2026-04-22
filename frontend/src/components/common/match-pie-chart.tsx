import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
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
    { name: '优秀', value: data.excellent.count, color: COLORS.excellent },
    { name: '良好', value: data.good.count, color: COLORS.good },
    { name: '一般', value: data.average.count, color: COLORS.average },
    { name: '未达标', value: data.fail.count, color: COLORS.fail },
  ].filter(item => item.value > 0);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        暂无评估数据
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [`${value}份`, name]}
        />
        <Legend
          formatter={(value: string) => <span className="text-sm">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}