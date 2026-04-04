"use client";

import { useState } from "react";

export default function ImportForm() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/import/zoom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fromDate, toDate }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import data");
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
          <label htmlFor="fromDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            From Date
          </label>
          <input
            id="fromDate"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label htmlFor="toDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            To Date
          </label>
          <input
            id="toDate"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Importing..." : "Import Zoom Data"}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-200 font-semibold mb-2">
            Import Successful!
          </p>
          <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
            <p>Meetings imported: {result.meetings}</p>
            <p>Total attendees: {result.totalAttendees}</p>
          </div>

          {result.data && result.data.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                Imported Meetings:
              </p>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-green-100 dark:bg-green-900/30">
                    <tr>
                      <th className="px-3 py-2 text-left text-green-900 dark:text-green-100">Topic</th>
                      <th className="px-3 py-2 text-left text-green-900 dark:text-green-100">Start Time</th>
                      <th className="px-3 py-2 text-left text-green-900 dark:text-green-100">Participants</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-200 dark:divide-green-800">
                    {result.data.map((meeting: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-green-800 dark:text-green-200">{meeting.topic}</td>
                        <td className="px-3 py-2 text-green-700 dark:text-green-300">
                          {new Date(meeting.start_time).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-green-700 dark:text-green-300">{meeting.participants}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
