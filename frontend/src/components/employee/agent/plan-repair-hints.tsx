import { Lightbulb } from 'lucide-react';

interface PlanRepairHintsProps {
  suggestions: string[];
}

/** 展示 Planner 修订建议 */
export function PlanRepairHints({ suggestions }: PlanRepairHintsProps) {
  if (suggestions.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm text-slate-700">
        <div className="flex items-center gap-2 font-semibold text-amber-900">
        <Lightbulb size={15} className="shrink-0" aria-hidden="true" />
        修订建议
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
        {suggestions.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
