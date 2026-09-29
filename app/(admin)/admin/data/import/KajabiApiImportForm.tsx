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
      const response = await fetch("/api/import/kajabi", {
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
          className="w-full px-6 py-3 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white font-semibold rounded-lg transition-colors"
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
          <div className="p-4 bg-plum-50 dark:bg-plum-900/20 border border-plum-200 dark:border-plum-800 rounded-lg">
            <p className="text-sm text-plum-800 dark:text-plum-200 font-semibold mb-2">
              ✓ Kajabi Sync Complete
            </p>
            <div className="text-sm text-plum-700 dark:text-plum-300 space-y-1">
              <p className="font-semibold">Bronze Layer (raw data):</p>
              <div className="pl-4 space-y-0.5">
                <p>• {result.members.contacts} contacts</p>
                <p>• {result.members.customers} customers</p>
                <p>• {result.members.purchases} purchases</p>
                <p>• {result.members.offers} offers</p>
              </div>

              {result.members.processing && result.members.processing.length > 0 && (
                <div className="mt-2 pt-2 border-t border-plum-200 dark:border-plum-700">
                  <p className="font-semibold">Silver Layer (processed):</p>
                  {result.members.processing.map((p: any, i: number) => (
                    <div key={i} className="pl-4">
                      <p className="font-semibold">• {p.table}: {p.success ? '✓' : '✗'}</p>
                      {!p.success && p.error && (
                        <p className="pl-4 text-sm text-red-700 dark:text-red-300 break-words">{p.error}</p>
                      )}
                      {p.emailConflicts?.length > 0 && (
                        <div className="pl-4 text-sm text-amber-700 dark:text-amber-300">
                          <p>
                            {p.emailConflicts.length} member{p.emailConflicts.length === 1 ? '' : 's'} not updated: their
                            new Kajabi email already belongs to another member. Merge the two, then sync again.
                          </p>
                          {p.emailConflicts.map((c: any) => (
                            <p key={c.kajabi_id}>
                              • {c.email}:{' '}
                              {c.member_ids.map((id: string) => (
                                <a key={id} href={`/admin/members/${id}`} className="underline mr-1">this member</a>
                              ))}
                              vs <a href={`/admin/members/${c.conflicting_member_id}`} className="underline">existing member</a>
                            </p>
                          ))}
                        </div>
                      )}
                      {p.processed !== undefined && (
                        <div className="pl-4 space-y-0.5 text-sm">
                          <p>Total members: {p.processed}</p>
                          {p.statusBreakdown && (
                            <>
                              <p>Active: {p.statusBreakdown.active}</p>
                              <p>On hiatus: {p.statusBreakdown.on_hiatus}</p>
                              <p>Cancelled: {p.statusBreakdown.cancelled}</p>
                              <p>Leads: {p.statusBreakdown.lead}</p>
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
