"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface IgnoredHere {
  zoomName: string;
  reason: string | null;
}

/** Zoom names an admin hid on this prickle only, with why, and a way to bring one back. */
export default function IgnoredZoomNames({ prickleId, items }: { prickleId: string; items: IgnoredHere[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const undo = async (zoomName: string) => {
    setBusy(zoomName);
    setError(null);
    try {
      const response = await fetch("/api/zoom/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoomName, prickleId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to un-ignore name");
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Ignored on this prickle</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.zoomName} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              <span className="font-mono">&quot;{item.zoomName}&quot;</span>
              {item.reason && <span className="text-slate-500 dark:text-slate-400"> · {item.reason}</span>}
            </span>
            <button
              onClick={() => undo(item.zoomName)}
              disabled={busy === item.zoomName}
              className="px-2 py-1 text-xs text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded hover:border-slate-400 disabled:opacity-50"
            >
              {busy === item.zoomName ? "Undoing..." : "Undo"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
