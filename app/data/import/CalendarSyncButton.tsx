"use client";

import { useState } from "react";

export default function CalendarSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);

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
      setSyncResult(data);
    } catch (error: any) {
      setSyncResult({ error: error.message });
    } finally {
      setSyncing(false);
    }
  };


  return (
    <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      <h4 className="font-semibold mb-2">Quick Sync (30 days back, 90 days forward)</h4>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
        Import from Google Calendar and auto-process into Prickles
      </p>

      <button
        onClick={handleSync}
        disabled={syncing}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm"
      >
        {syncing ? "Syncing..." : "Sync Calendar"}
      </button>

      {syncResult && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm ${
            syncResult.error
              ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
              : "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
          }`}
        >
          {syncResult.error ? (
            <p>{syncResult.error}</p>
          ) : (
            <div>
              <p className="font-semibold mb-1">✓ Sync Complete (auto-processing in background)</p>
              <ul className="text-xs space-y-0.5">
                <li>Total: {syncResult.total || 0}</li>
                <li>New: {syncResult.imported || 0}</li>
                <li>Updated: {syncResult.updated || 0}</li>
                <li>Unchanged: {syncResult.skipped || 0}</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
