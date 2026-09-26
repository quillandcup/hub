"use client";

import { useState } from "react";
import type { PrickleScheduleRow, PrickleInstance } from "@/lib/prickle-schedule";
import AllPricklesTable from "./AllPricklesTable";
import AllPricklesCalendar from "./AllPricklesCalendar";

type ViewMode = "table" | "calendar";

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
        <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-sm flex-shrink-0">
          <button
            type="button"
            onClick={() => setView("table")}
            className={`px-3 py-1.5 transition-colors ${
              view === "table"
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={`px-3 py-1.5 transition-colors border-l border-slate-300 dark:border-slate-600 ${
              view === "calendar"
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            Calendar
          </button>
        </div>
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
