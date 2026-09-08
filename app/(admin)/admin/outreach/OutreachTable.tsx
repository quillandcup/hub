"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import { SortableTh } from "@/components/SortableTh";
import { useTableSort } from "@/lib/hooks/useTableSort";

export type LeadStatus = "hot" | "warm" | "cold";

export interface OutreachLead {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
  instagramUrl: string | null;
  memberStatus: string;
  outreachStatus: LeadStatus;
  outreachUpdatedAt: string | null;
}

interface OutreachTableProps {
  leads: OutreachLead[];
}

const STATUS_META: Record<LeadStatus, { label: string; badgeClass: string; buttonClass: string }> = {
  hot: {
    label: "Hot",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    buttonClass: "bg-red-600 hover:bg-red-700 text-white",
  },
  warm: {
    label: "Warm",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    buttonClass: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  cold: {
    label: "Cold",
    badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    buttonClass: "bg-slate-500 hover:bg-slate-600 text-white",
  },
};

const STATUS_ORDER: Record<LeadStatus, number> = { hot: 0, warm: 1, cold: 2 };

// Kajabi's socials.instagram is stored as a full profile URL
// (toSocialUrl in app/api/process/members/route.ts) — pull the @handle back
// out for the DM deep link, which needs the bare handle, not the URL.
function instagramHandle(instagramUrl: string | null): string | null {
  if (!instagramUrl) return null;
  const match = instagramUrl.match(/instagram\.com\/([^/?#]+)/i);
  return match ? match[1] : null;
}

type SortColumn = "name" | "email" | "outreachStatus";

function getSortValue(lead: OutreachLead, column: SortColumn): string | number {
  switch (column) {
    case "name":
      return lead.name.toLowerCase();
    case "email":
      return lead.email.toLowerCase();
    case "outreachStatus":
      return STATUS_ORDER[lead.outreachStatus];
  }
}

function StatusButtons({
  status,
  busy,
  onChange,
}: {
  status: LeadStatus;
  busy: boolean;
  onChange: (status: LeadStatus) => void;
}) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
      {(Object.keys(STATUS_META) as LeadStatus[]).map((option) => {
        const meta = STATUS_META[option];
        const active = status === option;
        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            disabled={busy || active}
            className={`px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-default ${
              active
                ? meta.buttonClass
                : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

export default function OutreachTable({ leads }: OutreachTableProps) {
  const router = useRouter();
  const [rows, setRows] = useState(leads);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { sortColumn, sortDirection, handleSort, sortedRows } = useTableSort<OutreachLead, SortColumn>({
    rows,
    getSortValue,
    defaultSort: { column: "outreachStatus", direction: "asc" },
  });

  const updateStatus = async (memberId: string, status: LeadStatus) => {
    setBusyId(memberId);
    setError(null);
    // Optimistic update — the buttons disable the active option, so a failed
    // request is rare, but revert on error rather than leaving a false state.
    const previous = rows;
    setRows((r) => r.map((lead) => (lead.id === memberId ? { ...lead, outreachStatus: status } : lead)));
    try {
      const response = await fetch("/api/admin/outreach-leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update outreach status");
      router.refresh();
    } catch (err: any) {
      setRows(previous);
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <SortableTh
                label="Hedgie"
                active={sortColumn === "name"}
                direction={sortDirection}
                onClick={() => handleSort("name")}
              />
              <SortableTh
                label="Email"
                active={sortColumn === "email"}
                direction={sortDirection}
                onClick={() => handleSort("email")}
              />
              <SortableTh
                label="Status"
                active={sortColumn === "outreachStatus"}
                direction={sortDirection}
                onClick={() => handleSort("outreachStatus")}
              />
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Instagram
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {sortedRows.map((lead) => {
              const handle = instagramHandle(lead.instagramUrl);
              const busy = busyId === lead.id;
              return (
                <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <MemberAvatar name={lead.name} photoUrl={lead.photoUrl} size={36} />
                      <Link
                        href={`/admin/members/${lead.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        {lead.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                    {lead.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusButtons
                      status={lead.outreachStatus}
                      busy={busy}
                      onChange={(status) => updateStatus(lead.id, status)}
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={handle ? lead.instagramUrl! : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!handle}
                        title={handle ? "View Instagram profile" : "No Instagram on file"}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          handle
                            ? "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
                            : "bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed pointer-events-none"
                        }`}
                      >
                        Profile
                      </a>
                      <a
                        href={handle ? `https://ig.me/m/${handle}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={!handle}
                        title={
                          handle
                            ? "Open a DM with this lead — from whichever Instagram account is logged in on this device"
                            : "No Instagram on file"
                        }
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                          handle
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed pointer-events-none"
                        }`}
                      >
                        DM
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
