"use client";

import { useState } from "react";
import type { PrickleScheduleRow, PrickleInstance } from "@/lib/prickle-schedule";
import AllPricklesTable from "./AllPricklesTable";
import AllPricklesCalendar from "./AllPricklesCalendar";
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
}: {
  rows: PrickleScheduleRow[];
  instances: PrickleInstance[];
  timeZone: string;
  upcomingWindowDays: number;
  lookbackDays: number;
}) {
  const [view, setView] = useState<ViewMode>("table");

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
        <PillFilter
          variant="segmented"
          ariaLabel="View"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
        />
      </div>

      {view === "table" ? (
        <AllPricklesTable rows={rows} />
      ) : (
        <AllPricklesCalendar
          instances={instances}
          timeZone={timeZone}
          upcomingWindowDays={upcomingWindowDays}
          lookbackDays={lookbackDays}
        />
      )}
    </div>
  );
}
