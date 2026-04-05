"use client";

import { useState } from "react";

export default function ZoomImportAndProcessForm() {
  // Default to last 30 days
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const defaultFromDate = thirtyDaysAgo.toISOString().split("T")[0];

  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(today);

  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [processLoading, setProcessLoading] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportLoading(true);
    setImportError(null);
    setImportResult(null);

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

      setImportResult(data);
    } catch (err: any) {
      setImportError(err.message || "An error occurred during import");
    } finally {
      setImportLoading(false);
    }
  };

  const handleProcess = async () => {
    setProcessLoading(true);
    setProcessError(null);
    setProcessResult(null);

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

      setProcessResult(data);
    } catch (err: any) {
      setProcessError(err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleImport} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
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
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={importLoading}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
          >
            {importLoading ? "Importing..." : "1. Import Zoom Data"}
          </button>

          <button
            type="button"
            onClick={handleProcess}
            disabled={processLoading || !importResult}
            className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors"
          >
            {processLoading ? "Processing..." : "2. Process Attendance"}
          </button>
        </div>
      </form>

      {importError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Import Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{importError}</p>
        </div>
      )}

      {importResult && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
            ✓ Imported {importResult.meetings} meetings with {importResult.totalAttendees} total attendees
          </p>
        </div>
      )}

      {processError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Processing Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{processError}</p>
        </div>
      )}

      {processResult && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
            ✓ Successfully processed attendance
          </p>
          <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
            <p>• {processResult.zoomAttendees} Zoom attendees</p>
            <p>• {processResult.matchedAttendees} matched to members ({processResult.matchRate}% match rate)</p>
            <p>• {processResult.skippedUnmatched} unmatched</p>
            {processResult.matchedToCalendar !== undefined && (
              <p>• {processResult.matchedToCalendar} matched to scheduled prickles</p>
            )}
            {processResult.createdNewPrickles !== undefined && (
              <p>• {processResult.createdNewPrickles} Pop-Up Prickles created for unscheduled meetings</p>
            )}
            <p>• {processResult.attendanceRecords} attendance records created</p>
          </div>
        </div>
      )}
    </div>
  );
}
