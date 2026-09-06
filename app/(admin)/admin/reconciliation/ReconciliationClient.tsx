"use client";

import { useEffect, useState } from "react";
import MemberOverrideForm from "@/components/MemberOverrideForm";

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
  override_id: string | null;
  override_type: string | null;
  override_reason: string | null;
  override_notes: string | null;
  override_starts_at: string | null;
  override_expires_at: string | null;
  is_on_hiatus: boolean;
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

interface OrphanSlackUser {
  slack_user_id: string;
  email: string | null;
  real_name: string;
  display_name: string;
}

interface SlackData {
  total_in_slack: number;
  members_in_slack: string[];
  orphan_slack_users: OrphanSlackUser[];
}

interface StripeOrphan {
  stripe_customer_id: string;
  email: string | null;
  name: string | null;
  created_at: string | null;
}

interface StripeOrphanData {
  total_active_subscriptions: number;
  orphans: StripeOrphan[];
}

interface ZoomInactiveMember {
  member_id: string;
  member_name: string;
  member_status: string;
  prickle_count: number;
}

interface ZoomUnmatchedAttendee {
  name: string;
  prickle_count: number;
}

interface ZoomAccessData {
  matched_inactive: ZoomInactiveMember[];
  unmatched: ZoomUnmatchedAttendee[];
}

interface KajabiGrant {
  kajabi_purchase_id: string;
  offer_name: string;
  amount_in_cents: number;
  created_at: string | null;
  member_id: string | null;
  member_name: string | null;
  member_email: string | null;
  member_status: string | null;
}

interface KajabiGrantsData {
  grants: KajabiGrant[];
}

export default function ReconciliationClient() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [slackData, setSlackData] = useState<SlackData | null>(null);
  const [stripeOrphanData, setStripeOrphanData] = useState<StripeOrphanData | null>(null);
  const [kajabiGrantsData, setKajabiGrantsData] = useState<KajabiGrantsData | null>(null);
  const [zoomAccessData, setZoomAccessData] = useState<ZoomAccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDiscrepancies, setFilterDiscrepancies] = useState(true);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchReconciliation(), fetchSlackData(), fetchStripeOrphans(), fetchKajabiGrants(), fetchZoomAccess()]);
    setLoading(false);
  };

  const fetchReconciliation = async () => {
    try {
      const response = await fetch("/api/analyze/subscription-reconciliation");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch reconciliation data");
      setData(result);
    } catch (err: any) {
      console.error("Error fetching reconciliation:", err);
      setError(err.message);
    }
  };

  const handleOverrideSaved = () => {
    setEditingMemberId(null);
    fetchReconciliation();
  };

  const fetchSlackData = async () => {
    try {
      const response = await fetch("/api/analyze/slack-reconciliation");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch Slack data");
      setSlackData(result);
    } catch (err: any) {
      console.error("Error fetching Slack reconciliation:", err);
    }
  };

  const fetchStripeOrphans = async () => {
    try {
      const response = await fetch("/api/analyze/stripe-orphans");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch Stripe orphans");
      setStripeOrphanData(result);
    } catch (err: any) {
      console.error("Error fetching Stripe orphans:", err);
    }
  };

  const fetchKajabiGrants = async () => {
    try {
      const response = await fetch("/api/analyze/kajabi-grants");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch Kajabi grants");
      setKajabiGrantsData(result);
    } catch (err: any) {
      console.error("Error fetching Kajabi grants:", err);
    }
  };

  const fetchZoomAccess = async () => {
    try {
      const response = await fetch("/api/analyze/zoom-access");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to fetch Zoom access data");
      setZoomAccessData(result);
    } catch (err: any) {
      console.error("Error fetching Zoom access:", err);
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

  const memberSlackSet = new Set(slackData?.members_in_slack ?? []);

  const hasDiscrepancy = (m: MemberReconciliation) =>
    m.has_discrepancy ||
    (slackData !== null && !memberSlackSet.has(m.member_id) && m.expected_kajabi_state === "active");

  // A member actively paying in Stripe (stripe_state: "paying") whose Kajabi-derived
  // status isn't active and who has no override yet — same discrepancy shape as
  // Abby VanLuvanee's ad-hoc Kajabi Payments subscription (docs/TODO.md "Ad-hoc
  // Kajabi Payments subscriptions aren't reconciled at all"). Suggests
  // 'direct_stripe' instead of making staff type it out each time.
  const suggestedOverride = (m: MemberReconciliation) =>
    !m.override_type && m.stripe_state === "paying" && m.actual_kajabi_state !== "active"
      ? {
          type: "direct_stripe" as const,
          reason: "Active Stripe subscription not reflected in Kajabi purchase data",
        }
      : null;

  const filteredMembers = filterDiscrepancies
    ? data.members.filter(hasDiscrepancy)
    : data.members;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2 dark:text-white">Subscription Reconciliation</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Compare expected vs actual member status across Stripe, Kajabi, and Slack
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 mb-6">
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
        {slackData && (
          <div className="p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded">
            <div className="text-2xl font-bold dark:text-white">{slackData.total_in_slack}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">In Slack</div>
          </div>
        )}
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
                Stripe
              </th>
              {slackData && (
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                  Slack
                </th>
              )}
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
                <td
                  colSpan={slackData ? 7 : 6}
                  className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  {filterDiscrepancies ? "No discrepancies found!" : "No members found"}
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const inSlack = memberSlackSet.has(member.member_id);
                return (
                  <tr
                    key={member.member_id}
                    className={`hover:bg-gray-50 dark:hover:bg-slate-800 ${
                      hasDiscrepancy(member) ? "bg-red-50 dark:bg-red-950/20" : ""
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
                    {slackData && (
                      <td className="px-4 py-3 text-sm">
                        {inSlack ? (
                          <span className="text-green-600 dark:text-green-400">✓</span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {member.override_type ? (
                        <div>
                          <span
                            className={`px-2 py-1 text-xs rounded font-medium ${
                              member.override_type === "gift"
                                ? "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300"
                                : member.override_type === "direct_stripe"
                                ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300"
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
                          <button
                            onClick={() =>
                              setEditingMemberId(editingMemberId === member.member_id ? null : member.member_id)
                            }
                            className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {editingMemberId === member.member_id ? "Cancel" : "Edit"}
                          </button>
                        </div>
                      ) : member.is_on_hiatus ? (
                        <div>
                          <span className="px-2 py-1 text-xs rounded font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
                            hiatus
                          </span>
                          <div className="mt-1">
                            <a
                              href={`/admin/members/${member.member_id}`}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Manage on member page →
                            </a>
                          </div>
                        </div>
                      ) : suggestedOverride(member) ? (
                        <div>
                          <span className="px-2 py-1 text-xs rounded font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            ⚡ Suggested: direct_stripe
                          </span>
                          <button
                            onClick={() =>
                              setEditingMemberId(editingMemberId === member.member_id ? null : member.member_id)
                            }
                            className="block mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {editingMemberId === member.member_id ? "Cancel" : "Review & apply"}
                          </button>
                        </div>
                      ) : (
                        <div>
                          <span className="text-gray-400 dark:text-gray-500 text-sm">None</span>
                          <button
                            onClick={() =>
                              setEditingMemberId(editingMemberId === member.member_id ? null : member.member_id)
                            }
                            className="block mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {editingMemberId === member.member_id ? "Cancel" : "Explain"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {hasDiscrepancy(member) ? (
                        <span className="text-red-600 dark:text-red-400 font-medium text-sm">
                          ⚠ Mismatch
                        </span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400 text-sm">✓ OK</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
            {filteredMembers
              .filter((m) => m.member_id === editingMemberId)
              .map((member) => (
                <tr key={`${member.member_id}-form`} className="bg-blue-50/50 dark:bg-blue-950/10">
                  <td colSpan={slackData ? 7 : 6} className="px-4 py-4">
                    <div className="max-w-md">
                      <MemberOverrideForm
                        memberId={member.member_id}
                        memberName={member.member_name}
                        existing={
                          member.override_id
                            ? {
                                id: member.override_id,
                                override_type: member.override_type as "gift" | "special" | "direct_stripe",
                                reason: member.override_reason ?? "",
                                notes: member.override_notes,
                                starts_at: member.override_starts_at ?? new Date().toISOString(),
                                expires_at: member.override_expires_at,
                              }
                            : null
                        }
                        suggestedType={suggestedOverride(member)?.type}
                        suggestedReason={suggestedOverride(member)?.reason}
                        onSaved={handleOverrideSaved}
                        onCancel={() => setEditingMemberId(null)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Orphan Slack users — in Slack but no member record at all */}
      {slackData && slackData.orphan_slack_users.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 dark:text-white">
            In Slack with no member record ({slackData.orphan_slack_users.length})
          </h2>
          <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                    Slack Name
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                    Email
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                {slackData.orphan_slack_users.map((u) => (
                  <tr key={u.slack_user_id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-4 py-3">
                      <div className="font-medium dark:text-white">{u.real_name}</div>
                      {u.display_name && u.display_name !== u.real_name && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          @{u.display_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {u.email ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active Stripe subscribers with no member record */}
      {stripeOrphanData && stripeOrphanData.orphans.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 dark:text-white">
            Active Stripe subscribers with no member record ({stripeOrphanData.orphans.length})
          </h2>
          <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Email</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Subscription Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                {stripeOrphanData.orphans.map((o) => (
                  <tr key={o.stripe_customer_id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-4 py-3 font-medium dark:text-white">
                      {o.name ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {o.email ?? <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {o.created_at ? new Date(o.created_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kajabi memberships granted with no real transaction behind them */}
      {kajabiGrantsData && kajabiGrantsData.grants.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 dark:text-white">
            Granted memberships — no payment behind them ({kajabiGrantsData.grants.length})
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Active in Kajabi with no transaction on the purchase — either granted via the API (no billing
            attached, won&apos;t auto-revoke on cancellation) or a manual comp. Worth a look before it becomes
            another invisible category, the way ad-hoc Stripe subscriptions did.
          </p>
          <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Member</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Offer</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Amount</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Granted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                {kajabiGrantsData.grants.map((g) => (
                  <tr key={g.kajabi_purchase_id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-4 py-3">
                      {g.member_id ? (
                        <a
                          href={`/admin/members/${g.member_id}`}
                          className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {g.member_name}
                        </a>
                      ) : (
                        <span className="font-medium dark:text-white">{g.member_email ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{g.offer_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {(g.amount_in_cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {g.created_at ? new Date(g.created_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zoom: attending prickles with inactive membership */}
      {zoomAccessData && zoomAccessData.matched_inactive.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 dark:text-white">
            Attending prickles — membership inactive ({zoomAccessData.matched_inactive.length})
          </h2>
          <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Member</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Prickles (last 90d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                {zoomAccessData.matched_inactive.map((m) => (
                  <tr key={m.member_id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-4 py-3 font-medium dark:text-white">{m.member_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{m.prickle_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zoom: attending prickles with no member record */}
      {zoomAccessData && zoomAccessData.unmatched.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold mb-3 dark:text-white">
            Attending prickles — no member record found ({zoomAccessData.unmatched.length})
          </h2>
          <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Prickles (last 90d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                {zoomAccessData.unmatched.map((u) => (
                  <tr key={u.name} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                    <td className="px-4 py-3 font-medium dark:text-white">{u.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{u.prickle_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={fetchAll}
          className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600"
        >
          Refresh Data
        </button>
      </div>
    </div>
  );
}
