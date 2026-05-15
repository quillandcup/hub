"use client";

import { useState } from "react";

export default function StripeImportForm() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/sync/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync Stripe data");
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
          Imports all Stripe data (subscriptions, customers, products) to Bronze layer for analysis and comparison with Kajabi data.
        </p>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Syncing from Stripe API..." : "Sync from Stripe API"}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && result.stripe && (
        <div className="mt-6">
          <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
            <p className="text-sm text-indigo-800 dark:text-indigo-200 font-semibold mb-2">
              ✓ Stripe Sync Complete
            </p>
            <div className="text-sm text-indigo-700 dark:text-indigo-300 space-y-1">
              <p className="font-semibold">Bronze Layer (raw data):</p>
              <div className="pl-4 space-y-0.5">
                <p>• {result.stripe.customers} customers</p>
                <p>• {result.stripe.products} products</p>
                <p>• {result.stripe.subscriptions} subscriptions</p>
              </div>

              {result.stripe.statusBreakdown && (
                <div className="mt-2 pt-2 border-t border-indigo-200 dark:border-indigo-700">
                  <p className="font-semibold">Subscription Status Breakdown:</p>
                  <div className="pl-4 space-y-0.5">
                    {Object.entries(result.stripe.statusBreakdown).map(([status, count]) => (
                      <p key={status}>• {status}: {count as number}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
