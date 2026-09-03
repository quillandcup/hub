"use client";

import { useState } from "react";

interface Candidate {
  id: string;
  name: string;
  email: string;
}

interface AmbiguousEntry {
  zoomName: string;
  occurrenceCount: number;
  lastSeenAt: string;
  candidates: Candidate[];
}

export default function AmbiguousNamesResolver({ entries }: { entries: AmbiguousEntry[] }) {
  const [resolvedNames, setResolvedNames] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const remaining = entries.filter((e) => !resolvedNames.has(e.zoomName));

  const resolve = async (zoomName: string, body: Record<string, unknown>) => {
    setErrors((prev) => ({ ...prev, [zoomName]: "" }));
    try {
      const response = await fetch("/api/zoom/resolve-ambiguous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoomName, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to resolve");
      setResolvedNames((prev) => new Set(prev).add(zoomName));
    } catch (error: any) {
      setErrors((prev) => ({ ...prev, [zoomName]: error.message }));
    } finally {
      setBusy(null);
    }
  };

  const assign = (zoomName: string, memberId: string) => {
    setBusy(`${zoomName}:${memberId}`);
    resolve(zoomName, { memberId });
  };

  const ignore = (zoomName: string) => {
    setBusy(`${zoomName}:ignore`);
    resolve(zoomName, { action: "ignore" });
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
          {remaining.length}
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-400">
          unresolved ambiguous name{remaining.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {remaining.length === 0 ? (
          <div className="p-12 text-center text-slate-500">All resolved! 🎉</div>
        ) : (
          remaining.map((entry) => (
            <div key={entry.zoomName} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  &quot;{entry.zoomName}&quot;
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {entry.occurrenceCount} occurrence{entry.occurrenceCount !== 1 ? "s" : ""} · last
                  seen {new Date(entry.lastSeenAt).toLocaleDateString()}
                </span>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                Matches {entry.candidates.length} members — every session where someone joined
                Zoom as just &quot;{entry.zoomName}&quot; had no attendance recorded for anyone.
                Which one actually uses this name?
              </p>

              <div className="flex flex-wrap gap-2">
                {entry.candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    onClick={() => assign(entry.zoomName, candidate.id)}
                    disabled={busy === `${entry.zoomName}:${candidate.id}`}
                    className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  >
                    {busy === `${entry.zoomName}:${candidate.id}`
                      ? "Assigning..."
                      : `This is ${candidate.name}`}
                  </button>
                ))}
                <button
                  onClick={() => ignore(entry.zoomName)}
                  disabled={busy === `${entry.zoomName}:ignore`}
                  className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded disabled:opacity-50"
                >
                  {busy === `${entry.zoomName}:ignore` ? "Ignoring..." : "Ignore"}
                </button>
              </div>

              {errors[entry.zoomName] && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  {errors[entry.zoomName]}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
