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

        <button
          type="submit"
          disabled={importLoading}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
        >
          {importLoading ? "Importing..." : "Import Zoom Data"}
        </button>
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
            ✓ Zoom Import & Processing Complete
          </p>
          <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <p>• Imported {importResult.meetings} meetings with {importResult.totalAttendees} total attendees to Bronze</p>
            {importResult.reprocessing && (
              <div className="mt-2 pl-4 border-l-2 border-blue-300 dark:border-blue-700">
                <p className="font-semibold text-blue-800 dark:text-blue-200">Processed to Silver:</p>
                {importResult.reprocessing.zoom_attendees?.processed?.map((p: any, i: number) => (
                  <div key={`attendees-${i}`}>
                    <p className="font-semibold">• {p.table}: {p.success ? '✓' : '✗'}</p>
                    {p.zoomAttendees !== undefined && (
                      <div className="pl-4 space-y-0.5 text-sm">
                        <p>Zoom attendees: {p.zoomAttendees}</p>
                        <p>Matched to members: {p.matchedAttendees} ({p.matchRate}% match rate)</p>
                        <p>Unmatched: {p.skippedUnmatched}</p>
                        {p.meetingsProcessed !== undefined && <p>Meetings processed: {p.meetingsProcessed}</p>}
                        {p.segmentsCreated !== undefined && (
                          <p className="ml-2">↳ {p.segmentsCreated} segments ({p.matchedToCalendar || 0} scheduled + {p.createdNewPrickles || 0} PUPs)</p>
                        )}
                        <p>Attendance records: {p.attendanceRecords}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
