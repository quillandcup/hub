"use client";

import { useState } from "react";

export default function ManualReprocessingSection() {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Date range state for date-scoped processing
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const handleProcess = async (endpoint: string, requiresDateRange: boolean) => {
    setLoading({ ...loading, [endpoint]: true });
    setErrors({ ...errors, [endpoint]: "" });
    setResults({ ...results, [endpoint]: null });

    try {
      const body: any = {};

      if (requiresDateRange) {
        if (!fromDate || !toDate) {
          throw new Error("Date range required");
        }
        body.fromDate = new Date(fromDate).toISOString();
        body.toDate = new Date(toDate + "T23:59:59Z").toISOString();
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Processing failed");
      }

      setResults({ ...results, [endpoint]: data });
    } catch (err: any) {
      setErrors({ ...errors, [endpoint]: err.message });
    } finally {
      setLoading({ ...loading, [endpoint]: false });
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-2">Manual Reprocessing</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Normally, data is automatically reprocessed when you import or change configuration.
        Use this section to manually reprocess data for troubleshooting or backfilling historical changes.
      </p>

      {/* Date Range Input (for date-scoped processing) */}
      <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          Date Range (for Calendar, Zoom, Slack)
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Processing Buttons */}
      <div className="space-y-3">
        <ProcessButton
          label="Reprocess Members"
          endpoint="/api/process/members"
          requiresDateRange={false}
          loading={loading["/api/process/members"]}
          result={results["/api/process/members"]}
          error={errors["/api/process/members"]}
          onProcess={() => handleProcess("/api/process/members", false)}
        />

        <ProcessButton
          label="Reprocess Calendar Prickles"
          endpoint="/api/process/calendar"
          requiresDateRange={true}
          loading={loading["/api/process/calendar"]}
          result={results["/api/process/calendar"]}
          error={errors["/api/process/calendar"]}
          onProcess={() => handleProcess("/api/process/calendar", true)}
        />

        <ProcessButton
          label="Reprocess Zoom Attendance"
          endpoint="/api/process/attendance"
          requiresDateRange={true}
          loading={loading["/api/process/attendance"]}
          result={results["/api/process/attendance"]}
          error={errors["/api/process/attendance"]}
          onProcess={() => handleProcess("/api/process/attendance", true)}
        />

        <ProcessButton
          label="Reprocess Hiatus Tracking"
          endpoint="/api/process/hiatus"
          requiresDateRange={false}
          loading={loading["/api/process/hiatus"]}
          result={results["/api/process/hiatus"]}
          error={errors["/api/process/hiatus"]}
          onProcess={() => handleProcess("/api/process/hiatus", false)}
        />
      </div>
    </div>
  );
}

function ProcessButton({
  label,
  endpoint,
  requiresDateRange,
  loading,
  result,
  error,
  onProcess,
}: {
  label: string;
  endpoint: string;
  requiresDateRange: boolean;
  loading?: boolean;
  result?: any;
  error?: string;
  onProcess: () => void;
}) {
  return (
    <div>
      <button
        onClick={onProcess}
        disabled={loading}
        className="w-full px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors text-sm"
      >
        {loading ? "Processing..." : label}
        {requiresDateRange && <span className="ml-2 text-xs opacity-75">(requires date range)</span>}
      </button>

      {error && (
        <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs">
          <p className="text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-xs">
          <p className="text-green-800 dark:text-green-200 font-semibold">✓ Success</p>
          <pre className="mt-1 text-green-700 dark:text-green-300 whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
