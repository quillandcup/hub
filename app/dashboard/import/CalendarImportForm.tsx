"use client";

import { useState } from "react";
import CalendarSyncButton from "./CalendarSyncButton";

export default function CalendarImportForm() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    setResult(null);

    try {
      const response = await fetch("/api/import/calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          calendarId: calendarId || undefined,
          fromDate,
          toDate,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error: any) {
      setResult({ error: error.message });
    } finally {
      setImporting(false);
    }
  };

  const handleProcess = async () => {
    setProcessLoading(true);
    setProcessError(null);
    setProcessResult(null);

    try {
      const response = await fetch("/api/process/calendar", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process calendar");
      }

      setProcessResult(data);
    } catch (err: any) {
      setProcessError(err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
        <h3 className="text-lg font-bold">Import Prickles from Google Calendar</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Fetch scheduled events from the configured calendar (uses service account)
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        <div>
          <label className="block text-sm font-medium mb-2">
            Calendar ID
          </label>
          <input
            type="text"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder="Leave empty to use GOOGLE_CALENDAR_ID from .env"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Optional: Leave empty to use GOOGLE_CALENDAR_ID from .env.local
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={importing}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
          >
            {importing ? "Importing..." : "1. Import Events"}
          </button>

          <button
            type="button"
            onClick={handleProcess}
            disabled={processLoading}
            className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors"
          >
            {processLoading ? "Processing..." : "2. Process Calendar"}
          </button>
        </div>
      </form>

      {/* Import Results */}
      {result && (
        <div
          className={`mt-6 p-4 rounded-lg ${
            result.error
              ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              : "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
          }`}
        >
          {result.error ? (
            <p className="text-red-800 dark:text-red-200">{result.error}</p>
          ) : (
            <div className="text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-2">✓ Import Successful!</p>
              <ul className="text-sm space-y-1">
                <li>Total events found: {result.total || 0}</li>
                <li>Imported (new): {result.imported || 0}</li>
                <li>Updated (changed): {result.updated || 0}</li>
                <li>Skipped (unchanged/invalid): {result.skipped || 0}</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Process Error */}
      {processError && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Processing Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{processError}</p>
        </div>
      )}

      {/* Process Results */}
      {processResult && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
            ✓ Successfully processed calendar events
          </p>
          <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
            <p>• Calendar events: {processResult.eventsProcessed || 0}</p>
            <p>• Prickles created: {processResult.pricklesCreated || 0}</p>
            <p>• Prickles updated: {processResult.pricklesUpdated || 0}</p>
            <p>• Skipped (no match): {processResult.skippedNoMatch || 0}</p>
          </div>
        </div>
      )}

      {/* Quick Sync */}
      <CalendarSyncButton />
    </div>
  );
}
