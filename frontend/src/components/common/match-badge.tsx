interface MatchBadgeProps {
  // 评估等级四档：≥85 优秀；70-84 良好；55-69 一般；<55 待改进
  label: '优秀' | '良好' | '一般' | '待改进';
}

export function MatchBadge({ label }: MatchBadgeProps) {
  const styles = {
    '优秀': 'bg-success/20 text-success',
    '良好': 'bg-primary/20 text-primary',
    '一般': 'bg-warning/20 text-warning',
    '待改进': 'bg-danger/20 text-danger',
  }[label] ?? 'bg-slate-100 text-slate-600';

  return (
    <span className={`px-3 py-1 rounded-full text-sm ${styles}`}>
      {label}
    </span>
  );
}
