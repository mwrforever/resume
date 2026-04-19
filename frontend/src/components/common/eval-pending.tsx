interface EvalPendingProps {
  onRefresh?: () => void;
}

export function EvalPending({ onRefresh }: EvalPendingProps) {
  return (
    <div className="py-12 text-center">
      <div className="text-4xl mb-4">⏳</div>
      <p className="text-lg text-secondary mb-4">评审还在进行中，请耐心等待</p>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
        >
          刷新状态
        </button>
      )}
    </div>
  );
}
