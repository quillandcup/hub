"use client";

import { useState } from "react";

export default function ProcessMembersButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/process/members", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process members");
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
      <button
        onClick={handleProcess}
        disabled={loading}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
      >
        {loading ? "Processing..." : "Process Members"}
      </button>

      {result && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
            ✓ Successfully processed {result.processed} members
          </p>
          {result.statusBreakdown && (
            <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
              <p>• {result.statusBreakdown.active} active</p>
              <p>• {result.statusBreakdown.on_hiatus} on hiatus</p>
              <p>• {result.statusBreakdown.inactive} inactive</p>
            </div>
          )}
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
