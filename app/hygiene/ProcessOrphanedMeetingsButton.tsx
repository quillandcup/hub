"use client";

import { useState } from "react";

interface ProcessOrphanedMeetingsButtonProps {
  orphanedCount: number;
  dateRange: { fromDate: string; toDate: string } | null;
}

export default function ProcessOrphanedMeetingsButton({ orphanedCount, dateRange }: ProcessOrphanedMeetingsButtonProps) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleProcess = async () => {
    // Require date range - no arbitrary fallbacks
    if (!dateRange) {
      setResult({
        success: false,
        message: "✗ Cannot determine date range of orphaned meetings. Please refresh the page and try again.",
      });
      return;
    }

    const fromFormatted = new Date(dateRange.fromDate).toLocaleDateString();
    const toFormatted = new Date(dateRange.toDate).toLocaleDateString();

    if (!confirm(`Process Zoom meetings to resolve ${orphanedCount} orphaned meetings?\n\nThis will reprocess attendance from ${fromFormatted} to ${toFormatted}.`)) {
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const response = await fetch("/api/process/attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process attendance");
      }

      setResult({
        success: true,
        message: `✓ Processed ${data.pupsCreated || 0} PUPs, ${data.attendanceRecords || 0} attendance records`,
      });

      // Refresh page after 2 seconds to show updated counts
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error: any) {
      setResult({
        success: false,
        message: `✗ ${error.message}`,
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleProcess}
        disabled={processing}
        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm"
      >
        {processing ? "Processing..." : "Process Orphaned Meetings"}
      </button>
      {result && (
        <span
          className={`text-sm ${
            result.success
              ? "text-green-700 dark:text-green-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
