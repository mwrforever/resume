import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";

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
      <RadarChart data={chartData}>
        <PolarGrid />
        <PolarAngleAxis dataKey="dimension" />
        <Radar
          name="得分"
          dataKey="score"
          stroke="#2563EB"
          fill="#2563EB"
          fillOpacity={0.5}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
