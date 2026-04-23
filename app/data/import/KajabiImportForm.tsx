"use client";

import { useState } from "react";

export default function KajabiImportForm() {
  const [membersFile, setMembersFile] = useState<File | null>(null);
  const [subscriptionsFile, setSubscriptionsFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!membersFile && !subscriptionsFile) {
      setError("Please select at least one CSV file");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const results: any = {
        members: null,
        subscriptions: null,
      };

      // Import members CSV if provided
      if (membersFile) {
        const formData = new FormData();
        formData.append("file", membersFile);

        const response = await fetch("/api/import/members", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(`Members: ${data.error || "Failed to import"}`);
        }

        results.members = data;
      }

      // Import subscriptions CSV if provided
      if (subscriptionsFile) {
        const formData = new FormData();
        formData.append("file", subscriptionsFile);

        const response = await fetch("/api/import/subscriptions", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(`Subscriptions: ${data.error || "Failed to import"}`);
        }

        results.subscriptions = data;
      }

      setResult(results);

      // Reset file inputs
      setMembersFile(null);
      setSubscriptionsFile(null);

      const inputs = document.querySelectorAll('input[type="file"]');
      inputs.forEach((input: any) => {
        input.value = "";
      });
    } catch (err: any) {
      setError(err.message || "An error occurred during import");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Members CSV (optional)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setMembersFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
            />
            {membersFile && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {membersFile.name}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Subscriptions CSV (optional)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setSubscriptionsFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
            />
            {subscriptionsFile && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {subscriptionsFile.name}
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || (!membersFile && !subscriptionsFile)}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Importing..." : "Import Kajabi CSVs"}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {result.members && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
                ✓ Members Import Successful
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Imported {result.members.imported} members (auto-processing in background)
              </p>
            </div>
          )}

          {result.subscriptions && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
                ✓ Subscriptions Import Successful
              </p>
              <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p>• Imported {result.subscriptions.imported} subscription records (auto-processing in background)</p>
                <p>• Import timestamp: {new Date(result.subscriptions.importTimestamp).toLocaleString()}</p>
                {result.subscriptions.statusBreakdown && (
                  <div className="mt-2">
                    <p className="font-semibold">Status Breakdown:</p>
                    {Object.entries(result.subscriptions.statusBreakdown).map(([status, count]) => (
                      <p key={status}>• {status}: {count as number}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
