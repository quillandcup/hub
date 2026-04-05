"use client";

import { useState } from "react";

export default function CalendarSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);

    try {
      const response = await fetch("/api/sync/calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          daysBack: 30,
          daysForward: 90,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error: any) {
      setResult({ error: error.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      <h4 className="font-semibold mb-2">Quick Sync</h4>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
        Sync events from the configured calendar (30 days back, 90 days forward)
      </p>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm"
      >
        {syncing ? "Syncing..." : "Sync Now"}
      </button>

      {result && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm ${
            result.error
              ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
              : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
          }`}
        >
          {result.error ? (
            <p>{result.error}</p>
          ) : (
            <div>
              <p className="font-semibold mb-1">Sync Complete!</p>
              <ul className="text-xs space-y-0.5">
                <li>Total: {result.total || 0}</li>
                <li>New: {result.imported || 0}</li>
                <li>Updated: {result.updated || 0}</li>
                <li>Unchanged: {result.skipped || 0}</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
