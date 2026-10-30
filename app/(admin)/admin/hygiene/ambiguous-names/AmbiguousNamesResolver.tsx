"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDateInZone } from "@/lib/formatters";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { useTimeZone } from "@/components/Timezone";

interface Candidate {
  id: string;
  name: string;
  displayName?: string | null;
  email: string;
}

interface AmbiguousEntry {
  zoomName: string;
  occurrenceCount: number;
  lastSeenAt: string;
  candidates: Candidate[];
  /** Newest first, capped; `occurrenceCount` is the full number. */
  sessions?: Array<{ topic: string | null; joinTime: string; prickleId?: string | null }>;
  /** Members most often in the same sessions, with how many of them. */
  companions?: Array<{ id: string; name: string; displayName?: string | null; sessions: number }>;
}

export default function AmbiguousNamesResolver({ entries }: { entries: AmbiguousEntry[] }) {
  const timeZone = useTimeZone();
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
          <div className="p-12 text-center text-slate-600 dark:text-slate-400">All resolved! 🎉</div>
        ) : (
          remaining.map((entry) => (
            <div key={entry.zoomName} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  &quot;{entry.zoomName}&quot;
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  {entry.occurrenceCount} occurrence{entry.occurrenceCount !== 1 ? "s" : ""} · last
                  seen {formatDateInZone(entry.lastSeenAt, timeZone)}
                </span>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-400 mb-1.5">
                Matches {entry.candidates.length} members — every session where someone joined
                Zoom as just &quot;{entry.zoomName}&quot; had no attendance recorded for anyone.
                Which one actually uses this name?
              </p>

              <div className="flex flex-wrap gap-1.5 items-center">
                {entry.candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => assign(entry.zoomName, candidate.id)}
                    disabled={busy === `${entry.zoomName}:${candidate.id}`}
                    className="px-2 py-1 text-xs bg-plum-50 dark:bg-plum-900/20 text-plum-700 dark:text-plum-300 border border-plum-200 dark:border-plum-800 rounded-full hover:bg-plum-100 dark:hover:bg-plum-900/40 disabled:opacity-50"
                    title={`${candidate.name} · ${candidate.email}`}
                  >
                    {busy === `${entry.zoomName}:${candidate.id}` ? "Assigning…" : getMemberDisplayName({ name: candidate.name, display_name: candidate.displayName })}
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

              {(entry.sessions?.length || entry.companions?.length) ? (
                <details className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  <summary className="cursor-pointer select-none">Sessions and who was there</summary>
                  {entry.companions?.length ? (
                    <p className="mt-2">
                      Most often there with:{" "}
                      {entry.companions.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && ", "}
                          <Link href={`/admin/members/${c.id}`} className="text-plum-700 dark:text-plum-300 hover:underline">
                            {getMemberDisplayName({ name: c.name, display_name: c.displayName })}
                          </Link>{" "}
                          ({c.sessions})
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {entry.sessions?.length ? (
                    <ul className="mt-2 space-y-0.5">
                      {entry.sessions.map((s, i) => (
                        <li key={`${s.joinTime}-${i}`}>
                          {formatDateInZone(s.joinTime, timeZone)} ·{" "}
                          {s.prickleId ? (
                            <Link href={`/admin/prickles/${s.prickleId}`} className="text-plum-700 dark:text-plum-300 hover:underline">
                              {s.topic || "Untitled session"}
                            </Link>
                          ) : (
                            s.topic || "Untitled session"
                          )}
                        </li>
                      ))}
                      {entry.occurrenceCount > entry.sessions.length && (
                        <li>…and {entry.occurrenceCount - entry.sessions.length} more</li>
                      )}
                    </ul>
                  ) : null}
                </details>
              ) : null}

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
