import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

interface RadarChartProps {
  data: { dimension: string; score: number }[];
}

export function EvaluationRadarChart({ data }: RadarChartProps) {
  const chartData = data.map((d) => ({
    dimension: d.dimension,
    score: d.score,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={chartData} outerRadius="72%">
        <PolarGrid stroke="#CBD5E1" radialLines={false} />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: '#475569', fontSize: 12, fontWeight: 600 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: '#94A3B8', fontSize: 11 }}
          tickCount={5}
          axisLine={false}
        />
        <Tooltip formatter={(value) => [`${value ?? 0} 分`, '得分']} />
        <Radar
          name="得分"
          dataKey="score"
          stroke="#2563EB"
          strokeWidth={2}
          fill="#60A5FA"
          fillOpacity={0.35}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
