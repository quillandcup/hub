"use client";

import { useState } from "react";

export default function KajabiApiImportForm() {
  const [importMembers, setImportMembers] = useState(true);
  const [importSubscriptions, setImportSubscriptions] = useState(true);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!importMembers && !importSubscriptions) {
      setError("Please select at least one data type to import");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sync/kajabi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          importMembers,
          importSubscriptions,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync Kajabi data");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || "An error occurred during sync");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={importMembers}
              onChange={(e) => setImportMembers(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Import Members
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Fetch all contacts from Kajabi API
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={importSubscriptions}
              onChange={(e) => setImportSubscriptions(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Import Subscriptions
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Fetch all subscription history from Kajabi API
              </p>
            </div>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading || (!importMembers && !importSubscriptions)}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Syncing from Kajabi API..." : "Sync from Kajabi API"}
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
                ✓ Members Import & Processing Complete
              </p>
              <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p>• Imported {result.members.imported} members to Bronze</p>
                {result.members.processing && result.members.processing.length > 0 && (
                  <div className="mt-2 pl-4 border-l-2 border-blue-300 dark:border-blue-700">
                    <p className="font-semibold">Processed to Silver:</p>
                    {result.members.processing.map((p: any, i: number) => (
                      <div key={i}>
                        <p className="font-semibold">• {p.table}: {p.success ? '✓' : '✗'}</p>
                        {p.processed !== undefined && (
                          <div className="pl-4 space-y-0.5 text-sm">
                            <p>Total members: {p.processed}</p>
                            {p.statusBreakdown && (
                              <>
                                <p>Active: {p.statusBreakdown.active}</p>
                                <p>On hiatus: {p.statusBreakdown.on_hiatus}</p>
                                <p>Inactive: {p.statusBreakdown.inactive}</p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {result.subscriptions && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
                ✓ Subscriptions Import & Processing Complete
              </p>
              <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p>• Imported {result.subscriptions.imported} subscription records to Bronze</p>
                <p>• Import timestamp: {new Date(result.subscriptions.importTimestamp).toLocaleString()}</p>
                {result.subscriptions.statusBreakdown && (
                  <div className="mt-2">
                    <p className="font-semibold">Status Breakdown:</p>
                    {Object.entries(result.subscriptions.statusBreakdown).map(([status, count]) => (
                      <p key={status}>• {status}: {count as number}</p>
                    ))}
                  </div>
                )}
                {result.subscriptions.processing && result.subscriptions.processing.length > 0 && (
                  <div className="mt-2 pl-4 border-l-2 border-blue-300 dark:border-blue-700">
                    <p className="font-semibold">Processed to Silver:</p>
                    {result.subscriptions.processing.map((p: any, i: number) => (
                      <div key={i}>
                        <p className="font-semibold">• {p.table}: {p.success ? '✓' : '✗'}</p>
                        {p.table === 'hiatus' && (
                          <div className="pl-4 space-y-0.5 text-sm">
                            <p>Hiatus periods detected: {p.detectedPeriods || 0}</p>
                            <p>Matched to members: {p.matchedToMembers || 0}</p>
                            {p.statusBreakdown && (
                              <>
                                <p>Ongoing: {p.statusBreakdown.ongoing || 0}</p>
                                <p>Completed: {p.statusBreakdown.completed || 0}</p>
                              </>
                            )}
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
      )}
    </div>
  );
}
