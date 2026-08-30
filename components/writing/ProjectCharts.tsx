"use client";

import { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { computeCumulativeSeries, MEASURE_LABELS, type WritingMeasure } from "@/lib/writing-projects";
import type { EntryRow } from "@/app/(member)/writing/actions";

const HEATMAP_WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateLabel(dateStr: unknown) {
  if (typeof dateStr !== "string") return "";
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** Sunday-start grid of the last HEATMAP_WEEKS weeks, ending on the most recent Saturday on/after `today`. */
function buildHeatmapWeeks(totalsByDate: Map<string, number>, today: Date): { date: string; total: number }[][] {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysToSaturday = 6 - end.getUTCDay();
  end.setUTCDate(end.getUTCDate() + daysToSaturday);

  const weeks: { date: string; total: number }[][] = [];
  for (let w = HEATMAP_WEEKS - 1; w >= 0; w--) {
    const week: { date: string; total: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const dayMs = end.getTime() - w * 7 * DAY_MS - (6 - d) * DAY_MS;
      const iso = new Date(dayMs).toISOString().slice(0, 10);
      week.push({ date: iso, total: totalsByDate.get(iso) ?? 0 });
    }
    weeks.push(week);
  }
  return weeks;
}

function heatmapColor(total: number, max: number): string {
  if (total <= 0) return "bg-slate-100 dark:bg-slate-800";
  const ratio = max > 0 ? total / max : 0;
  if (ratio > 0.75) return "bg-blue-700";
  if (ratio > 0.5) return "bg-blue-600";
  if (ratio > 0.25) return "bg-blue-400";
  return "bg-blue-200 dark:bg-blue-900";
}

interface ProjectChartsProps {
  entries: EntryRow[];
}

export default function ProjectCharts({ entries }: ProjectChartsProps) {
  const measuresWithEntries = useMemo(() => {
    const counts = new Map<WritingMeasure, number>();
    for (const e of entries) counts.set(e.measure, (counts.get(e.measure) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [entries]);

  const [measure, setMeasure] = useState<WritingMeasure | null>(measuresWithEntries[0] ?? null);
  const activeMeasure = measure ?? measuresWithEntries[0] ?? null;

  const measureEntries = useMemo(
    () => entries.filter((e) => e.measure === activeMeasure),
    [entries, activeMeasure]
  );

  const series = useMemo(() => computeCumulativeSeries(measureEntries), [measureEntries]);

  const totalsByDate = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of measureEntries) totals.set(e.entryDate, (totals.get(e.entryDate) ?? 0) + e.amount);
    return totals;
  }, [measureEntries]);

  const heatmapWeeks = useMemo(() => buildHeatmapWeeks(totalsByDate, new Date()), [totalsByDate]);
  const maxDayTotal = Math.max(0, ...[...totalsByDate.values()]);

  if (!activeMeasure) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Stats</h2>
        {measuresWithEntries.length > 1 && (
          <select
            value={activeMeasure}
            onChange={(e) => setMeasure(e.target.value as WritingMeasure)}
            className="px-2 py-1 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800"
          >
            {measuresWithEntries.map((m) => (
              <option key={m} value={m}>
                {MEASURE_LABELS[m]}
              </option>
            ))}
          </select>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={series}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
          <XAxis dataKey="entryDate" tickFormatter={formatDateLabel} className="text-xs fill-slate-600 dark:fill-slate-400" />
          <YAxis className="text-xs fill-slate-600 dark:fill-slate-400" />
          <Tooltip
            labelFormatter={formatDateLabel}
            formatter={(value) => [`${Number(value).toLocaleString()} ${MEASURE_LABELS[activeMeasure].toLowerCase()}`, "Total"]}
            contentStyle={{
              backgroundColor: "var(--tooltip-bg, #1e293b)",
              border: "none",
              borderRadius: "8px",
              color: "var(--tooltip-text, #fff)",
            }}
          />
          <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.5} name="Total" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-6 flex flex-col items-center">
        <div className="flex gap-1.5">
          {heatmapWeeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1.5">
              {week.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${day.total.toLocaleString()} ${MEASURE_LABELS[activeMeasure].toLowerCase()}`}
                  className={`w-5 h-5 rounded-sm ${heatmapColor(day.total, maxDayTotal)}`}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-2">Last {HEATMAP_WEEKS} weeks</p>
      </div>
    </div>
  );
}
