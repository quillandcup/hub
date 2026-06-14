"use client";

import { useState } from "react";
import Link from "next/link";
import BulkMergeMemberModal from "./BulkMergeMemberModal";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  status: string;
  member_metrics: {
    last_attended_at: string | null;
    prickles_last_30_days: number | null;
    total_prickles: number | null;
    engagement_score: number | null;
  } | null;
  member_engagement: {
    risk_level: string | null;
    engagement_tier: string | null;
  } | null;
}

interface MembersTableProps {
  members: MemberRow[];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
    on_hiatus: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status] ?? colors.inactive}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const colors: Record<string, string> = {
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[risk] ?? colors.low}`}>
      {risk}
    </span>
  );
}

export default function MembersTable({ members }: MembersTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergeModalOpen, setMergeModalOpen] = useState(false);

  const allSelected = members.length > 0 && selectedIds.size === members.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < members.length;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(members.map((m) => m.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const selectedMembers = members
    .filter((m) => selectedIds.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, email: m.email }));

  return (
    <>
      {selectedIds.size > 0 && (
        <div className="px-6 py-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 flex items-center gap-4">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {selectedIds.size} selected
          </span>
          {selectedIds.size >= 2 && (
            <button
              onClick={() => setMergeModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Merge
            </button>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="accent-blue-600 cursor-pointer"
                  aria-label="Select all"
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Last Attended
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                30 Days
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Total
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Engagement
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Risk
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {members.map((member) => (
              <tr
                key={member.id}
                className={`hover:bg-slate-50 dark:hover:bg-slate-800 ${selectedIds.has(member.id) ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
              >
                <td className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(member.id)}
                    onChange={() => toggleOne(member.id)}
                    className="accent-blue-600 cursor-pointer"
                    aria-label={`Select ${member.name}`}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <Link
                    href={`/admin/members/${member.id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {member.name}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-slate-500 dark:text-slate-400">{member.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <StatusBadge status={member.status} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                  {member.member_metrics?.last_attended_at
                    ? new Date(member.member_metrics.last_attended_at).toLocaleDateString()
                    : "Never"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                  {member.member_metrics?.prickles_last_30_days ?? 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                  {member.member_metrics?.total_prickles ?? 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                  {member.member_metrics?.engagement_score ?? 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <RiskBadge risk={member.member_engagement?.risk_level ?? "low"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mergeModalOpen && selectedMembers.length >= 2 && (
        <BulkMergeMemberModal
          members={selectedMembers}
          isOpen={mergeModalOpen}
          onClose={() => {
            setMergeModalOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </>
  );
}
