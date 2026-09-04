"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { WorkQueueItem, WorkQueueType } from "@/lib/admin-work-queue";
import { parseDateOnly } from "@/lib/member-tenure";

interface WorkQueueSectionsProps {
  welcomeBackQueue: WorkQueueItem[];
  hedgieversaryQueue: WorkQueueItem[];
  hiatusNudgeQueue: WorkQueueItem[];
}

const SECTION_META: Record<
  WorkQueueType,
  { title: string; description: string; emptyText: string; badgeClass: string }
> = {
  welcome_back: {
    title: "Welcome Back",
    description: "Hiatus has ended — re-enable Slack access, Kajabi, etc.",
    emptyText: "No one to welcome back right now.",
    badgeClass: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  hedgieversary: {
    title: "Hedgieversary Celebrations",
    description: "Post on Instagram and give a shoutout in Slack.",
    emptyText: "No Hedgieversaries to celebrate right now.",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  hiatus_nudge: {
    title: "Hiatus Nudges",
    description: "Send a check-in at the 25%, 50%, and 75% marks of a hiatus.",
    emptyText: "No hiatus nudges due right now.",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  },
};

function fmt(dateOnly: string): string {
  return parseDateOnly(dateOnly).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function QueueSection({ items }: { items: WorkQueueItem[] }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<{ id: string; key: string } | null>(null);

  if (items.length === 0) return null;
  const meta = SECTION_META[items[0].queueType];

  const markDone = async (item: WorkQueueItem) => {
    const key = `${item.queueType}:${item.memberId}:${item.occurrenceKey}`;
    setBusyKey(key);
    setError(null);
    try {
      const response = await fetch("/api/admin/work-queue/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queue_type: item.queueType,
          member_id: item.memberId,
          occurrence_key: item.occurrenceKey,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to mark done");
      setUndoable({ id: data.completion.id, key });
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  const undo = async () => {
    if (!undoable) return;
    setBusyKey(undoable.key);
    try {
      const response = await fetch(`/api/admin/work-queue/complete/${undoable.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to undo");
      }
      setUndoable(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">
            {meta.title} <span className="text-slate-400 dark:text-slate-500 font-normal">({items.length})</span>
          </h2>
          {undoable && (
            <button
              onClick={undo}
              disabled={busyKey === undoable.key}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              Undo last
            </button>
          )}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{meta.description}</p>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Deadline
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Hedgie
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Event
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {items.map((item) => {
              const key = `${item.queueType}:${item.memberId}:${item.occurrenceKey}`;
              return (
                <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 dark:text-slate-300">
                    {fmt(item.deadline)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      href={`/admin/members/${item.memberId}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      {item.memberName}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${meta.badgeClass}`}>
                      {item.label}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => markDone(item)}
                      disabled={busyKey === key}
                      className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                    >
                      {busyKey === key ? "Saving..." : "Mark Done"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function WorkQueueSections({
  welcomeBackQueue,
  hedgieversaryQueue,
  hiatusNudgeQueue,
}: WorkQueueSectionsProps) {
  const allEmpty =
    welcomeBackQueue.length === 0 && hedgieversaryQueue.length === 0 && hiatusNudgeQueue.length === 0;

  if (allEmpty) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center">
        <p className="text-slate-500 dark:text-slate-400">Nothing in the queue right now. 🎉</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <QueueSection items={welcomeBackQueue} />
      <QueueSection items={hedgieversaryQueue} />
      <QueueSection items={hiatusNudgeQueue} />
    </div>
  );
}
