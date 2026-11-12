"use client";

import { useState } from "react";
import { DataTablePager } from "@/components/DataTablePager";
import { CARE_STATUS_LABELS, type CareStatus } from "@/lib/care";
import type { CareOwner } from "@/lib/care-owners";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { EngagementCardData } from "./card";
import EngagementCard from "./EngagementCard";
import OwnerFilter, { matchesOwner, useOwnerChoice } from "./OwnerFilter";

const EMPTY = "rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400";

type ListProps = { cards: EngagementCardData[]; canWrite: boolean; owners: readonly CareOwner[]; meId: string };

const chipClass = (pressed: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${
    pressed ? "border-plum-600 bg-plum-600 text-white" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
  }`;

type ActiveFilter = "all" | Exclude<CareStatus, "lapsed" | "closed">;
const ACTIVE_FILTERS: ActiveFilter[] = ["all", "needs_reply", "review_due", "gone_quiet", "waiting"];

/** The Active tab, in the order the server sorted it (what needs her first), with an owner filter and a chip per status to narrow it. */
export function ActiveList({ cards, canWrite, owners, meId }: ListProps) {
  const [filter, setFilter] = useState<ActiveFilter>("all");
  const [choice, setChoice] = useOwnerChoice();
  const mine = cards.filter((c) => matchesOwner(c, choice, meId));
  const count = (f: ActiveFilter) => (f === "all" ? mine.length : mine.filter((c) => c.status === f).length);
  const shown = filter === "all" ? mine : mine.filter((c) => c.status === filter);

  return (
    <section aria-label="Active care plans">
      <OwnerFilter cards={cards} owners={owners} meId={meId} choice={choice} onChoose={setChoice} />
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
        {ACTIVE_FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={chipClass(filter === f)}>
            {f === "all" ? "All" : CARE_STATUS_LABELS[f]} ({count(f)})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className={EMPTY}>{cards.length === 0 ? "Nothing active. Start a care plan above." : "Nothing here."}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((card) => (
            <EngagementCard key={card.id} card={card} canWrite={canWrite} owners={owners} />
          ))}
        </ul>
      )}
    </section>
  );
}

type EarlierFilter = "all" | "closed" | "lapsed";
const EARLIER_FILTERS: EarlierFilter[] = ["all", "lapsed", "closed"];

/** The Earlier tab: closed and lapsed engagements, most recently ended first (the server sorted them), with the owner filter, paged. */
export function EarlierList({ cards, canWrite, owners, meId }: ListProps) {
  const [filter, setFilter] = useState<EarlierFilter>("all");
  const [choice, setChoice] = useOwnerChoice();
  const mine = cards.filter((c) => matchesOwner(c, choice, meId));
  const count = (f: EarlierFilter) => (f === "all" ? mine.length : mine.filter((c) => c.status === f).length);
  const shown = filter === "all" ? mine : mine.filter((c) => c.status === filter);
  const table = useDataTable<EngagementCardData, never>({ rows: shown, getSortValue: () => null, pageSize: 20, resetKey: `${filter}:${choice}` });

  return (
    <section aria-label="Earlier care plans">
      {cards.length === 0 ? (
        <p className={EMPTY}>Nothing has ended yet.</p>
      ) : (
        <>
          <OwnerFilter cards={cards} owners={owners} meId={meId} choice={choice} onChoose={setChoice} />
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
            {EARLIER_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={chipClass(filter === f)}>
                {f === "all" ? "All" : CARE_STATUS_LABELS[f]} ({count(f)})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className={EMPTY}>Nothing here.</p>
          ) : (
            <>
              <ul className="space-y-3">
                {table.rows.map((card) => (
                  <EngagementCard key={card.id} card={card} canWrite={canWrite} owners={owners} />
                ))}
              </ul>
              <DataTablePager table={table} itemLabel="care plans" />
            </>
          )}
        </>
      )}
    </section>
  );
}
