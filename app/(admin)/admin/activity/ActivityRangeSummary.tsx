import Link from "next/link";
import { describeFeedWindow, type FeedFilters } from "@/lib/activity-feed";

/**
 * What the feed is showing, in plain words ("12 events, 3 Nov to 17 Nov"), with a Clear while a custom range is on, and the
 * reason when the URL's range was not used. The same line for an admin and a community manager.
 */
export default function ActivityRangeSummary({
  filters,
  total,
  now,
  clearHref,
}: {
  filters: Pick<FeedFilters, "days" | "range" | "rangeNotice">;
  total: number;
  now: Date;
  /** Where Clear goes: the tab with the custom range removed and every other filter kept. */
  clearHref: string;
}) {
  return (
    <div className="mb-3 space-y-1">
      {filters.rangeNotice && (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-300">
          {filters.rangeNotice}
        </p>
      )}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {describeFeedWindow(filters, total, now)}
        {filters.range && (
          <>
            {" "}
            <Link href={clearHref} className="font-medium text-plum-600 hover:underline dark:text-plum-400">
              Clear
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
