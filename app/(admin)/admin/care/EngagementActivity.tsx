"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTimeZone } from "@/components/Timezone";
import { track } from "@/lib/analytics/client";
import { formatDateOnly, formatDateTime } from "@/lib/formatters";
import { orgYmd } from "@/lib/org-week";
import { loadCarePlanActivity, type PlanActivityItem, type PlanActivityPage } from "./actions";

/**
 * "Activity during this plan": what the member did while this care plan ran (their prickles, Slack and chat messages, lessons,
 * check-ins and the emails the Hub sent them), with the plan's own moments (started, renewed, handed over, closed), newest first
 * and a page at a time. Read-only, and never the text of a message: a message is a time and a place. It is the plan's own
 * stretch, so an earlier plan of the same member lists only what happened then.
 */
export default function EngagementActivity({ planId }: { planId: string }) {
  const timeZone = useTimeZone();
  const [items, setItems] = useState<PlanActivityItem[]>([]);
  const [info, setInfo] = useState<PlanActivityPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const asked = useRef(false);

  function load(page: number) {
    setError(null);
    startTransition(async () => {
      const answer = await loadCarePlanActivity(planId, page);
      if ("error" in answer) return setError(answer.error);
      setInfo(answer);
      setItems((before) => (page === 1 ? answer.items : [...before, ...answer.items.filter((item) => !before.some((b) => b.id === item.id))]));
      if (page === 1) track("care_activity_opened", { plan_open: answer.open, rows: answer.total });
    });
  }

  // Opening the panel is what asks for the first page, once.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load only reads planId, and the first page is asked for once
  }, []);

  const shown = items.length;
  const more = info !== null && shown < info.total;

  return (
    <section aria-label="Activity during this plan" className="mt-3 @container">
      {info && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          From {formatDateOnly(orgYmd(new Date(info.fromIso)))} {info.open ? "until now" : `to ${formatDateOnly(orgYmd(new Date(Date.parse(info.toIso) - 1)))}`}: {info.total} {info.total === 1 ? "thing" : "things"}. Messages show where and when, never what was said.
        </p>
      )}
      {!info && !error && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Loading…</p>}
      {info && info.total === 0 && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Nothing yet in the Hub during this care plan.</p>}
      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5 py-1.5 @pair:flex-row @pair:gap-3">
              <time dateTime={item.occurredAt} className="shrink-0 text-xs text-slate-600 @pair:w-44 dark:text-slate-400">
                {formatDateTime(item.occurredAt, timeZone)}
              </time>
              <span className={item.care ? "font-medium text-plum-800 dark:text-plum-200" : "text-slate-800 dark:text-slate-200"}>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button
          type="button"
          data-track="care-activity-more"
          disabled={pending}
          onClick={() => load((info?.page ?? 1) + 1)}
          className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {pending ? "Loading…" : "Show older"}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
