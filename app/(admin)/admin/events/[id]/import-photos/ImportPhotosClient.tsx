"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Phase = "picking" | "importing" | "done" | "error";

interface ImportProgress {
  total: number;
  imported: number;
  skipped: number;
  remaining: number;
}

export default function ImportPhotosClient({ eventId, pickerUri }: { eventId: string; pickerUri: string }) {
  const [phase, setPhase] = useState<Phase>("picking");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const pollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/events/${eventId}/photos/import/status`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to check picker status");
      if (body.mediaItemsSet) {
        setPhase("importing");
        return;
      }
      pollTimeout.current = setTimeout(pollStatus, body.pollIntervalMs || 2000);
    } catch (err: any) {
      setError(err.message);
      setPhase("error");
    }
  }, [eventId]);

  useEffect(() => {
    pollStatus();
    return () => {
      if (pollTimeout.current) clearTimeout(pollTimeout.current);
    };
  }, [pollStatus]);

  const runImportLoop = useCallback(async () => {
    try {
      let remaining = 1;
      while (remaining > 0) {
        const response = await fetch(`/api/admin/events/${eventId}/photos/import/commit`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Import failed");
        setProgress(body);
        remaining = body.remaining;
      }
      setPhase("done");
    } catch (err: any) {
      setError(err.message);
      setPhase("error");
    }
  }, [eventId]);

  useEffect(() => {
    if (phase === "importing") runImportLoop();
  }, [phase, runImportLoop]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 space-y-4">
      {phase === "picking" && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Open Google Photos, navigate to this event&apos;s album, and select the photos to import (or select all).
            Come back to this tab once you&apos;re done — it&apos;ll pick up automatically.
          </p>
          <a
            href={`${pickerUri}/autoclose`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Open Google Photos picker
          </a>
          <p className="text-sm text-slate-500 dark:text-slate-500">Waiting for you to finish picking…</p>
        </>
      )}

      {phase === "importing" && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">Importing photos…</p>
          {progress && (
            <div>
              <div className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${Math.round(((progress.imported + progress.skipped) / Math.max(progress.total, 1)) * 100)}%` }}
                />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-2">
                {progress.imported} of {progress.total} imported
                {progress.skipped > 0 ? ` (${progress.skipped} already imported)` : ""}
              </p>
            </div>
          )}
        </>
      )}

      {phase === "done" && (
        <>
          <p className="text-sm text-green-700 dark:text-green-400">
            Done — {progress?.imported ?? 0} of {progress?.total ?? 0} photos imported
            {progress?.skipped ? ` (${progress.skipped} were already imported)` : ""}.
          </p>
          <Link href={`/admin/events/${eventId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
            ← Back to event
          </Link>
        </>
      )}

      {phase === "error" && (
        <>
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          <Link href={`/admin/events/${eventId}`} className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
            ← Back to event
          </Link>
        </>
      )}
    </div>
  );
}
