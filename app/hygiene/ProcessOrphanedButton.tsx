"use client";

import { useState } from "react";

interface ProcessOrphanedButtonProps {
  orphanedCount: number;
}

export default function ProcessOrphanedButton({ orphanedCount }: ProcessOrphanedButtonProps) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleProcess = async () => {
    if (!confirm(`Process calendar events to resolve ${orphanedCount} orphaned events?\n\nThis will reprocess all calendar events from the past 6 months.`)) {
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      // Process last 6 months to catch any orphaned events
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - 6);

      const response = await fetch("/api/process/calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process calendar events");
      }

      setResult({
        success: true,
        message: `✓ Processed ${data.pricklesCreated || 0} prickles, ${data.unmatchedCount || 0} unmatched`,
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
        className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm"
      >
        {processing ? "Processing..." : "Process Orphaned Events"}
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
