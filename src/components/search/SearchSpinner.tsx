/** A small spinning ring with a label, for "Searching…" states that must be visible on a phone. */
export default function SearchSpinner({ label = "Searching…", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 ${className}`}>
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-plum-600 dark:border-slate-600 dark:border-t-plum-300" />
      {label}
    </div>
  );
}
