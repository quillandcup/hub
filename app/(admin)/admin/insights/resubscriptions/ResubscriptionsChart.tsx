"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { ResubscriptionCohort } from "@/app/api/analyze/resubscriptions/route";

interface Props {
  data: ResubscriptionCohort[];
}

export default function ResubscriptionsChart({ data }: Props) {
  // Only show months with at least one event OR the last 12 months
  const trimmedData = trimLeadingZeros(data);

  if (trimmedData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
        No resubscription data yet
      </div>
    );
  }

  const maxCount = Math.max(...trimmedData.map((d) => d.count), 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={trimmedData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "currentColor" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "currentColor" }}
          tickLine={false}
          axisLine={false}
          domain={[0, maxCount + 1]}
          width={28}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const count = payload[0].value as number;
            return (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 shadow text-sm">
                <div className="font-medium text-slate-700 dark:text-slate-200">{label}</div>
                <div className="text-blue-600 dark:text-blue-400">
                  {count} resubscription{count !== 1 ? "s" : ""}
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {trimmedData.map((entry) => (
            <Cell
              key={entry.month}
              fill={entry.count > 0 ? "#3b82f6" : "#e2e8f0"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function trimLeadingZeros(data: ResubscriptionCohort[]): ResubscriptionCohort[] {
  let firstNonZero = data.findIndex((d) => d.count > 0);
  if (firstNonZero === -1) return [];
  // Keep one zero before first event for context
  firstNonZero = Math.max(0, firstNonZero - 1);
  return data.slice(firstNonZero);
}
