"use client";

import { useState } from "react";

export default function CalendarImportForm() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [calendarId, setCalendarId] = useState("primary");
  const [refreshToken, setRefreshToken] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [authenticating, setAuthenticating] = useState(false);

  const handleAuthenticate = async () => {
    setAuthenticating(true);
    try {
      const response = await fetch("/api/google-calendar/auth");
      const data = await response.json();

      if (data.authUrl) {
        // Open auth URL in new window
        window.open(data.authUrl, "_blank");
      } else {
        setResult({ error: "Failed to get auth URL" });
      }
    } catch (error: any) {
      setResult({ error: error.message });
    } finally {
      setAuthenticating(false);
    }
  };

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
          calendarId,
          fromDate,
          toDate,
          refreshToken: refreshToken || undefined,
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

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 mb-6">
        <h3 className="text-lg font-bold">Import Prickles from Google Calendar</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Fetch scheduled events from your Google Calendar
        </p>
      </div>

      {/* Authentication Section */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          Step 1: Authenticate with Google
        </h4>
        <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
          Click the button below to authenticate with Google Calendar. After authenticating,
          copy the refresh token from the URL and paste it below.
        </p>
        <button
          onClick={handleAuthenticate}
          disabled={authenticating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          {authenticating ? "Opening..." : "Authenticate with Google"}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Refresh Token (from authentication)
          </label>
          <input
            type="text"
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            placeholder="Paste refresh token here (or leave empty to use .env)"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Optional: Leave empty to use GOOGLE_REFRESH_TOKEN from .env.local
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Calendar ID
          </label>
          <input
            type="text"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder="primary"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Default: "primary" (your main calendar)
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

        <button
          type="submit"
          disabled={importing}
          className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          {importing ? "Importing..." : "Import Events"}
        </button>
      </form>

      {/* Results */}
      {result && (
        <div
          className={`mt-6 p-4 rounded-lg ${
            result.error
              ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              : "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
          }`}
        >
          {result.error ? (
            <p className="text-red-800 dark:text-red-200">{result.error}</p>
          ) : (
            <div className="text-green-800 dark:text-green-200">
              <p className="font-semibold mb-2">Import Successful!</p>
              <ul className="text-sm space-y-1">
                <li>Total events found: {result.total || 0}</li>
                <li>Imported: {result.imported || 0}</li>
                <li>Skipped (duplicates/invalid): {result.skipped || 0}</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
