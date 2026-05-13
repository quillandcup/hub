"use client";

import { useEffect, useState } from "react";

interface ReconciliationSummary {
  total_members: number;
  active_in_stripe: number;
  paused_in_stripe: number;
  active_in_kajabi: number;
  total_overrides: number;
  discrepancies: number;
}

interface MemberReconciliation {
  member_id: string;
  member_name: string;
  member_email: string;
  expected_kajabi_state: string;
  actual_kajabi_state: string;
  stripe_state: string;
  override_type: string | null;
  override_reason: string | null;
  has_discrepancy: boolean;
}

interface ReconciliationData {
  summary: ReconciliationSummary;
  members: MemberReconciliation[];
  metadata: {
    kajabi_import_timestamp: string | null;
    stripe_import_timestamp: string | null;
  };
}

export default function ReconciliationPage() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDiscrepancies, setFilterDiscrepancies] = useState(true);

  useEffect(() => {
    fetchReconciliation();
  }, []);

  const fetchReconciliation = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/analyze/subscription-reconciliation");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch reconciliation data");
      }

      setData(result);
    } catch (err: any) {
      console.error("Error fetching reconciliation:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Subscription Reconciliation</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Subscription Reconciliation</h1>
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const filteredMembers = filterDiscrepancies
    ? data.members.filter((m) => m.has_discrepancy)
    : data.members;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2 dark:text-white">Subscription Reconciliation</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Compare expected vs actual member status across Stripe and Kajabi
        </p>
        {data.metadata.kajabi_import_timestamp && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Data as of: Kajabi{" "}
            {new Date(data.metadata.kajabi_import_timestamp).toLocaleString()}
            {data.metadata.stripe_import_timestamp &&
              `, Stripe ${new Date(
                data.metadata.stripe_import_timestamp
              ).toLocaleString()}`}
          </p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
          <div className="text-2xl font-bold dark:text-white">{data.summary.total_members}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Members</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {data.summary.active_in_stripe}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Paying (Stripe)</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
            {data.summary.paused_in_stripe}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Paused (Stripe)</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {data.summary.active_in_kajabi}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Active (Kajabi)</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {data.summary.total_overrides}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Overrides</div>
        </div>
        <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
          <div
            className={`text-2xl font-bold ${
              data.summary.discrepancies > 0
                ? "text-red-600 dark:text-red-400"
                : "text-green-600 dark:text-green-400"
            }`}
          >
            {data.summary.discrepancies}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Discrepancies</div>
        </div>
      </div>

      {/* Filter Toggle */}
      <div className="mb-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filterDiscrepancies}
            onChange={(e) => setFilterDiscrepancies(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm dark:text-gray-300">Show only discrepancies</span>
        </label>
      </div>

      {/* Members Table */}
      <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Member
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Expected (Kajabi)
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Actual (Kajabi)
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Stripe State
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Override
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {filterDiscrepancies
                    ? "No discrepancies found!"
                    : "No members found"}
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => (
                <tr
                  key={member.member_id}
                  className={`hover:bg-gray-50 dark:hover:bg-slate-800 ${
                    member.has_discrepancy ? "bg-red-50 dark:bg-red-950/20" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium dark:text-white">{member.member_name}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {member.member_email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded font-medium ${
                        member.expected_kajabi_state === "active"
                          ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300"
                          : member.expected_kajabi_state === "inactive"
                          ? "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                          : "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300"
                      }`}
                    >
                      {member.expected_kajabi_state}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded font-medium ${
                        member.actual_kajabi_state === "active"
                          ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {member.actual_kajabi_state}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded font-medium ${
                        member.stripe_state === "paying"
                          ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300"
                          : member.stripe_state === "paused"
                          ? "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300"
                          : member.stripe_state === "past_due"
                          ? "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {member.stripe_state}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {member.override_type ? (
                      <div>
                        <span
                          className={`px-2 py-1 text-xs rounded font-medium ${
                            member.override_type === "gift"
                              ? "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300"
                              : member.override_type === "hiatus"
                              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {member.override_type}
                        </span>
                        {member.override_reason && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {member.override_reason}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500 text-sm">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {member.has_discrepancy ? (
                      <span className="text-red-600 dark:text-red-400 font-medium text-sm">
                        ⚠ Mismatch
                      </span>
                    ) : (
                      <span className="text-green-600 dark:text-green-400 text-sm">✓ OK</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <button
          onClick={fetchReconciliation}
          className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600"
        >
          Refresh Data
        </button>
      </div>
    </div>
  );
}
