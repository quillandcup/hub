"use client";

import { useState } from "react";

export default function ProcessAttendanceForm() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to last 90 days
  const today = new Date().toISOString().split("T")[0];
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const defaultFromDate = ninetyDaysAgo.toISOString().split("T")[0];

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(today);

  const handleProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/process/attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fromDate, toDate }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process attendance");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleProcess} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="fromDate" className="block text-sm font-medium mb-1">
              From Date
            </label>
            <input
              type="date"
              id="fromDate"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800"
            />
          </div>
          <div>
            <label htmlFor="toDate" className="block text-sm font-medium mb-1">
              To Date
            </label>
            <input
              type="date"
              id="toDate"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
        >
          {loading ? "Processing..." : "Process Attendance"}
        </button>
      </form>

      {result && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
            ✓ Successfully processed attendance
          </p>
          <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
            <p>• {result.zoomAttendees} Zoom attendees</p>
            <p>• {result.matchedAttendees} matched to members ({result.matchRate}% match rate)</p>
            <p>• {result.skippedUnmatched} unmatched</p>
            <p>• {result.pricklesCreated} prickles created</p>
            <p>• {result.attendanceRecords} attendance records created</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}
    </div>
  );
}
