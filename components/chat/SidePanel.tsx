import Link from "next/link";

/**
 * The right-hand panel beside a conversation, as in Slack: a thread or a profile, opened by a
 * link (?thread= / ?profile=) and closed by the link back to the bare conversation. It scrolls on
 * its own; on narrow screens it covers the conversation instead of squeezing it.
 */
export default function SidePanel({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className="flex h-full min-h-0 shrink-0 flex-col border-l border-slate-200 bg-canvas dark:border-slate-800 dark:bg-slate-950 max-md:absolute max-md:inset-0 max-md:z-20 md:w-96"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="font-semibold">{title}</h2>
        <Link
          href={closeHref}
          scroll={false}
          aria-label={`Close ${title.toLowerCase()}`}
          className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          ✕
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">{children}</div>
    </aside>
  );
}
