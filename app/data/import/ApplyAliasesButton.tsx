"use client";

import { useState } from "react";

export default function ApplyAliasesButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/admin/apply-aliases", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to apply aliases");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">Member Aliases</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Apply member name aliases from <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">supabase/member-aliases.csv</code> to improve Zoom attendance matching.
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Run this <strong>after importing members from Kajabi</strong>.
      </p>

      <button
        onClick={handleApply}
        disabled={loading}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-medium transition-colors"
      >
        {loading ? "Applying..." : "Apply Aliases"}
      </button>

      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
            ✓ Applied aliases
          </p>
          <div className="text-sm text-green-700 dark:text-green-300 space-y-1 mb-3">
            <p>• Total: {result.total}</p>
            <p>• Created: {result.created}</p>
            <p>• Skipped: {result.skipped}</p>
            <p>• Errors: {result.errors}</p>
          </div>
          {result.messages && result.messages.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-green-800 dark:text-green-200 font-medium">
                Show details
              </summary>
              <ul className="mt-2 space-y-1 text-green-700 dark:text-green-300 list-disc list-inside">
                {result.messages.map((msg: string, idx: number) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
