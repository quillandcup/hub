"use client";

import { useState } from "react";
import { DataTablePager } from "@/components/DataTablePager";
import { CARE_STATUS_LABELS, type CareStatus } from "@/lib/care";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { EngagementCardData } from "./card";
import EngagementCard from "./EngagementCard";

const EMPTY = "rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400";

type ActiveFilter = "all" | Exclude<CareStatus, "lapsed" | "closed">;
const ACTIVE_FILTERS: ActiveFilter[] = ["all", "needs_reply", "review_due", "gone_quiet", "waiting"];

/** The Active tab, in the order the server sorted it (what needs her first), with a chip per status to narrow it. */
export function ActiveList({ cards, canWrite }: { cards: EngagementCardData[]; canWrite: boolean }) {
  const [filter, setFilter] = useState<ActiveFilter>("all");
  const count = (f: ActiveFilter) => (f === "all" ? cards.length : cards.filter((c) => c.status === f).length);
  const shown = filter === "all" ? cards : cards.filter((c) => c.status === filter);

  return (
    <section aria-label="Active engagements">
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
        {ACTIVE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f
                ? "border-plum-600 bg-plum-600 text-white"
                : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            }`}
          >
            {f === "all" ? "All" : CARE_STATUS_LABELS[f]} ({count(f)})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className={EMPTY}>{cards.length === 0 ? "Nothing active. Start an engagement above." : "Nothing here."}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((card) => (
            <EngagementCard key={card.id} card={card} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Earlier tab: closed and lapsed engagements, most recently ended first (the server sorted them), paged. */
export function EarlierList({ cards, canWrite }: { cards: EngagementCardData[]; canWrite: boolean }) {
  const table = useDataTable<EngagementCardData, never>({ rows: cards, getSortValue: () => null, pageSize: 20 });
  return (
    <section aria-label="Earlier engagements">
      {cards.length === 0 ? (
        <p className={EMPTY}>Nothing has ended yet.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {table.rows.map((card) => (
              <EngagementCard key={card.id} card={card} canWrite={canWrite} />
            ))}
          </ul>
          <DataTablePager table={table} itemLabel="engagements" />
        </>
      )}
    </section>
  );
}
