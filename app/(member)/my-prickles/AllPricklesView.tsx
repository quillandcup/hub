"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PrickleScheduleRow, PrickleInstance } from "@/lib/prickle-schedule";
import { buildSlotOptions } from "@/lib/commitments";
import AllPricklesTable from "./AllPricklesTable";
import AllPricklesCalendar from "./AllPricklesCalendar";
import CommitPanel from "./CommitPanel";
import { PillFilter } from "@/components/PillFilter";

type ViewMode = "table" | "calendar";

const VIEW_OPTIONS = [
  { id: "table", label: "Table" },
  { id: "calendar", label: "Calendar" },
] as const;

export default function AllPricklesView({
  rows,
  instances,
  timeZone,
  upcomingWindowDays,
  lookbackDays,
  initialCommitKeys,
}: {
  rows: PrickleScheduleRow[];
  instances: PrickleInstance[];
  timeZone: string;
  upcomingWindowDays: number;
  lookbackDays: number;
  /** From ?commit=<seriesKey>[,<seriesKey>...]: open commit mode with these slots picked. null = closed. */
  initialCommitKeys?: string[] | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("table");

  // Committable slots = the recurring schedule rows (each has an upcoming occurrence).
  const slotOptions = useMemo(() => buildSlotOptions(rows, timeZone), [rows, timeZone]);
  const optionByKey = useMemo(() => new Map(slotOptions.map((o) => [o.key, o])), [slotOptions]);
  const selectable = useMemo(() => new Set(optionByKey.keys()), [optionByKey]);

  const [committing, setCommitting] = useState(initialCommitKeys != null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((initialCommitKeys ?? []).filter((k) => optionByKey.has(k)))
  );

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function close() {
    setCommitting(false);
    setSelected(new Set());
  }

  // Keep the schedule's order (day, then time) for the picked list.
  const pickedSlots = slotOptions.filter((o) => selected.has(o.key));
  const selection = committing ? { selected, selectable, onToggle: toggle } : undefined;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            All Prickles
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            The full recurring weekly schedule — also known as Prickle Times. Times shown in your timezone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!committing && slotOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setCommitting(true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40"
            >
              📌 Make a commitment
            </button>
          )}
          <PillFilter variant="segmented" ariaLabel="View" options={VIEW_OPTIONS} value={view} onChange={setView} />
        </div>
      </div>

      {committing && (
        <CommitPanel
          slots={pickedSlots}
          onRemove={toggle}
          onCommitted={() => {
            setSelected(new Set());
            router.refresh();
          }}
          onClose={close}
        />
      )}

      {view === "table" ? (
        <AllPricklesTable rows={rows} selection={selection} />
      ) : (
        <AllPricklesCalendar
          instances={instances}
          timeZone={timeZone}
          upcomingWindowDays={upcomingWindowDays}
          lookbackDays={lookbackDays}
          selection={selection}
        />
      )}
    </div>
  );
}
