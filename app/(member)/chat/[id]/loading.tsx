/**
 * Shown in the conversation pane while a conversation loads, so a click in the sidebar answers at
 * once (the sidebar stays, the pane shows its shape) instead of the old conversation lingering.
 */
export default function ChatChannelLoading() {
  return (
    <div role="status" aria-label="Loading conversation" className="flex h-full min-h-0 flex-col animate-pulse">
      <div className="shrink-0 border-b border-slate-200 px-6 pb-3 pt-5 dark:border-slate-800">
        <div className="h-8 w-48 rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="flex-1 space-y-6 px-6 py-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-9 w-9 shrink-0 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-3 w-full max-w-md rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
