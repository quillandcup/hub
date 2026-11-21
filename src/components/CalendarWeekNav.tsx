import Link from "next/link";
import Kbd from "@/components/Kbd";

/** Today / Previous / Next links of the week calendar. Their keys are wired in `CalendarKeyboardNav` (t, p, n). */
export default function CalendarWeekNav({ todayHref, prevHref, nextHref }: { todayHref: string; prevHref: string; nextHref: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href={todayHref}
        data-track="admin-calendar-today"
        title="Jump to this week (t)"
        aria-keyshortcuts="t"
        className="flex items-center gap-2 px-3 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
      >
        Today
        <Kbd keys={["t"]} />
      </Link>
      <Link
        href={prevHref}
        title="Previous week (p)"
        aria-keyshortcuts="p"
        className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
      >
        ← Previous
        <Kbd keys={["p"]} />
      </Link>
      <Link
        href={nextHref}
        title="Next week (n)"
        aria-keyshortcuts="n"
        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
      >
        Next →
        <Kbd keys={["n"]} />
      </Link>
    </div>
  );
}
