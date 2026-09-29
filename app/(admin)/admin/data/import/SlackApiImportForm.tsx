"use client";

import { useState } from "react";

export default function SlackApiImportForm() {
  const [daysBack, setDaysBack] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/import/slack-api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ daysBack }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import Slack data");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || "An error occurred during import");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Date Range
          </label>
          <select
            value={daysBack}
            onChange={(e) => setDaysBack(parseInt(e.target.value))}
            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Importing from Slack..." : "Import from Slack"}
        </button>

        {loading && (
          <div className="mt-4 p-4 bg-plum-50 dark:bg-plum-900/20 border border-plum-200 dark:border-plum-800 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-plum-600"></div>
              <p className="text-sm text-plum-700 dark:text-plum-300">
                Fetching data from Slack API... This may take a few minutes for large date ranges.
              </p>
            </div>
          </div>
        )}
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 p-4 bg-plum-50 dark:bg-plum-900/20 border border-plum-200 dark:border-plum-800 rounded-lg">
          <p className="text-sm text-plum-800 dark:text-plum-200 font-semibold mb-2">
            ✓ Slack Import & Processing Complete
          </p>
          <div className="text-sm text-plum-700 dark:text-plum-300 space-y-1">
            <p>• {result.fetched?.users || 0} users fetched</p>
            <p>• {result.fetched?.channels || 0} channels fetched</p>
            <p>• {result.fetched?.messages || 0} messages fetched{result.fetched?.threadReplies ? ` (${result.fetched.threadReplies} thread replies)` : ''}</p>
            <p>• {result.fetched?.reactions || 0} reactions fetched</p>
          </div>
          {result.dateRange && (
            <p className="mt-3 text-sm text-plum-700 dark:text-plum-300">
              📅 Date range: {result.dateRange.fromDate} to {result.dateRange.toDate}
            </p>
          )}
          <div className="mt-3 pl-4 border-l-2 border-plum-300 dark:border-plum-700">
            <p className="font-semibold text-plum-800 dark:text-plum-200">Imported to Bronze:</p>
            <div className="text-sm text-plum-700 dark:text-plum-300 space-y-0.5">
              <p>• {result.imported?.users || 0} users</p>
              <p>• {result.imported?.channels || 0} channels</p>
              <p>• {result.imported?.messages || 0} messages</p>
              <p>• {result.imported?.reactions || 0} reactions</p>
              {result.imported?.reactionsRemoved > 0 && (
                <p>• {result.imported.reactionsRemoved} removed reactions deleted</p>
              )}
            </div>
          </div>
          {result.processing && result.processing.length > 0 && (
            <div className="mt-3 pl-4 border-l-2 border-plum-300 dark:border-plum-700">
              <p className="font-semibold text-plum-800 dark:text-plum-200">Processed to Silver:</p>
              {result.processing.map((p: any, i: number) => (
                <div key={i} className="text-sm text-plum-700 dark:text-plum-300">
                  <p className="font-semibold">• {p.table}: {p.success ? '✓' : '✗'}</p>
                  {!p.success && p.error && (
                    <p className="pl-4 text-red-700 dark:text-red-300 break-words">{p.error}</p>
                  )}
                  {p.processed && (
                    <div className="pl-4 space-y-0.5">
                      {p.processed.messages !== undefined && <p>Message activities: {p.processed.messages}</p>}
                      {p.processed.reactions !== undefined && <p>Reaction activities: {p.processed.reactions}</p>}
                      {p.processed.total_activities !== undefined && <p>Total activities: {p.processed.total_activities}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
