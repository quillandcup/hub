"use client";

import { useState } from "react";

export default function KajabiApiImportForm() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sync/kajabi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Imports all Kajabi data (contacts, customers, purchases, offers) to Bronze layer, then processes to canonical members in Silver layer.
        </p>

        <button
          type="submit"
          disabled={loading}
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

      {result && result.members && (
        <div className="mt-6">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
              ✓ Kajabi Sync Complete
            </p>
            <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <p className="font-semibold">Bronze Layer (raw data):</p>
              <div className="pl-4 space-y-0.5">
                <p>• {result.members.contacts} contacts</p>
                <p>• {result.members.customers} customers</p>
                <p>• {result.members.purchases} purchases</p>
                <p>• {result.members.offers} offers</p>
              </div>

              {result.members.processing && result.members.processing.length > 0 && (
                <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                  <p className="font-semibold">Silver Layer (processed):</p>
                  {result.members.processing.map((p: any, i: number) => (
                    <div key={i} className="pl-4">
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
        </div>
      )}
    </div>
  );
}
