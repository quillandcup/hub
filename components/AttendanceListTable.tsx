"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props {
  attendance: any[];
  timezone: string;
  activeListDateKey: string | undefined;
  memberId: string;
  memberBasePath?: string;
  prickleBasePath?: string;
}

// dateKey format: "MM/DD/YYYY"
function parseDateKey(k: string): number {
  const [m, d, y] = k.split("/").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatDateKey(dateKey: string): string {
  const [m, d, y] = dateKey.split("/").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AttendanceListTable({
  attendance,
  timezone,
  activeListDateKey,
  memberId,
  memberBasePath = "/members",
  prickleBasePath = "/prickles",
}: Props) {
  const router = useRouter();

  const byDate = new Map<string, any[]>();
  attendance.forEach((record) => {
    const key = new Date(record.join_time).toLocaleDateString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(record);
  });

  const descendingDateKeys = [...byDate.keys()].sort((a, b) => parseDateKey(b) - parseDateKey(a));

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });

  // Scroll to the active date section when it changes
  useEffect(() => {
    if (!activeListDateKey) return;
    const id = `list-date-${activeListDateKey.replace(/\//g, "-")}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeListDateKey]);

  if (attendance.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="p-12 text-center text-slate-500 dark:text-slate-400">
          No attendance records for this member
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Prickle Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Duration
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Host
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {descendingDateKeys.map((dateKey) => {
              const records = byDate.get(dateKey) || [];
              const isActive = dateKey === activeListDateKey;
              return (
                <>
                  <tr key={`header-${dateKey}`} id={`list-date-${dateKey.replace(/\//g, "-")}`}>
                    <td
                      colSpan={4}
                      className={`px-6 py-2 text-sm font-semibold border-t-2 ${
                        isActive
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100"
                          : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {formatDateKey(dateKey)}
                    </td>
                  </tr>
                  {records.map((record: any) => {
                    const prickle = record.prickles;
                    const joinTime = new Date(record.join_time);
                    const leaveTime = new Date(record.leave_time);
                    const duration = Math.round(
                      (leaveTime.getTime() - joinTime.getTime()) / 60000
                    );
                    return (
                      <tr
                        key={record.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        onClick={() => router.push(`${prickleBasePath}/${prickle.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {prickle.host?.id === memberId && "⭐ "}
                            {prickle.prickle_types?.name || "Unknown"}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {formatTime(joinTime)} – {formatTime(leaveTime)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {duration} min
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">
                          {prickle.host ? (
                            <Link
                              href={`${memberBasePath}/${prickle.host.id}`}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {prickle.host.name}
                            </Link>
                          ) : (
                            "None"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
