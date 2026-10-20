export interface FunnelBarStep {
  label: string;
  /** Visits that reached this step. */
  count: number;
}

/** An ordered funnel: each step's visits, and its share of the first step. */
export function FunnelBars({ steps }: { steps: FunnelBarStep[] }) {
  const top = steps[0]?.count ?? 0;
  return (
    <ol className="mt-3 space-y-2">
      {steps.map((step, i) => {
        const pct = top > 0 ? Math.round((step.count / top) * 100) : 0;
        return (
          <li key={i} className="text-sm">
            <div className="flex justify-between gap-4 text-slate-700 dark:text-slate-300">
              <span>{step.label}</span>
              <span className="shrink-0">
                {step.count} {step.count === 1 ? "visit" : "visits"}
                {i > 0 && top > 0 ? ` (${pct}% of step 1)` : ""}
              </span>
            </div>
            <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-slate-800">
              <div className="h-2 rounded bg-plum-500" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
