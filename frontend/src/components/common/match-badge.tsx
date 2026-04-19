interface MatchBadgeProps {
  label: '优秀' | '良好' | '一般' | '未达标';
}

export function MatchBadge({ label }: MatchBadgeProps) {
  const styles = {
    '优秀': 'bg-success/20 text-success',
    '良好': 'bg-primary/20 text-primary',
    '一般': 'bg-warning/20 text-warning',
    '未达标': 'bg-danger/20 text-danger',
  }[label];

  return (
    <span className={`px-3 py-1 rounded-full text-sm ${styles}`}>
      {label}
    </span>
  );
}
