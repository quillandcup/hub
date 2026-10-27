"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MemberSearch from "@/components/MemberSearch";
import { formatDateTimeRange } from "@/lib/formatters";
import { useTimeZone } from "@/components/Timezone";
import { UNHOSTED_LIST_LIMIT, type MissingHostsData } from "@/lib/missing-hosts";
import { assignHostToUnhostedPrickles, getUnhostedPrickles, setDefaultHosts, setRequiresHost, type UnhostedPrickle } from "./actions";

export default function MissingHostsClient({ stats, coverage, members }: MissingHostsData) {
  const timeZone = useTimeZone();
  const router = useRouter();
  // A default host is someone who hosts now, so only active members; crediting past prickles takes anyone.
  const activeMembers = members.filter((m) => m.status === "active");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [prickles, setPrickles] = useState<UnhostedPrickle[]>([]);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  // The breakdown of every calendar prickle by whether its type needs a host and whether one is assigned.
  const detailedStats = {
    total: coverage.total,
    withHost: coverage.requiresHost.withHost + coverage.optionalHost.withHost,
    withHostRequiring: coverage.requiresHost.withHost,
    withHostNotRequiring: coverage.optionalHost.withHost,
    withoutHost: coverage.requiresHost.withoutHost + coverage.optionalHost.withoutHost,
    withoutHostRequiring: coverage.requiresHost.withoutHost,
    withoutHostNotRequiring: coverage.optionalHost.withoutHost,
  };

  useEffect(() => {
    if (!selectedType) return;
    let cancelled = false;
    getUnhostedPrickles(selectedType).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        console.error("Error loading prickles:", result.error);
        return;
      }
      setPrickles(result.prickles);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedType]);

  // Writes go through server actions so they carry the admin's identity (and sudo context) for the audit log.
  async function toggleRequiresHost(typeId: string, currentValue: boolean) {
    const { error } = await setRequiresHost(typeId, !currentValue);
    if (error) alert(`Failed to update: ${error}`);
  }

  // Default hosts picked but not saved yet: type id -> the member chosen (null clears the default).
  const [staged, setStaged] = useState<Map<string, { id: string; name: string } | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  function stageDefaultHost(typeId: string, currentId: string | null, member: { id: string; name: string } | null) {
    setSaveResult(null);
    setStaged((prev) => {
      const next = new Map(prev);
      // Choosing what is already saved is no change
      if ((member?.id ?? null) === currentId) next.delete(typeId);
      else next.set(typeId, member ? { id: member.id, name: member.name } : null);
      return next;
    });
  }

  async function saveDefaultHosts() {
    setSaving(true);
    setSaveResult(null);
    const { error, saved } = await setDefaultHosts([...staged].map(([typeId, member]) => ({ typeId, memberId: member?.id ?? null })));
    setSaving(false);
    if (saved) setStaged(new Map());
    setSaveResult(error ?? `Saved ${saved} default host${saved === 1 ? "" : "s"} and rebuilt the calendar prickles.`);
  }

  // Crediting one member as the host of all of a type's unhosted prickles (the detail view).
  const [bulkHost, setBulkHost] = useState<{ id: string; name: string } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<string | null>(null);

  async function assignAll(typeId: string, count: number) {
    if (!bulkHost) return;
    if (!confirm(`Credit ${bulkHost.name} as the host of all ${count} unhosted prickles of this type?`)) return;
    setAssigning(true);
    setAssignResult(null);
    const { error, assigned } = await assignHostToUnhostedPrickles(typeId, bulkHost.id);
    setAssigning(false);
    setAssignResult(error ?? `Credited ${bulkHost.name} as the host of ${assigned} prickle${assigned === 1 ? "" : "s"}.`);
    if (!error) {
      setBulkHost(null);
      setPrickles([]);
      router.refresh();
    }
  }

  const expectedUnhosted = stats.filter(s => !s.requiresHost);
  const unexpectedUnhosted = stats.filter(s => s.requiresHost);
  const totalUnexpected = unexpectedUnhosted.reduce((sum, s) => sum + s.missingCount, 0);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 dark:text-slate-100">Prickles Missing Hosts</h1>

      <div className="space-y-8">
          {(staged.size > 0 || saveResult) && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-green-800 dark:text-green-200">Default Hosts to Save ({staged.size})</h3>
                {staged.size > 0 && (
                  <button
                    onClick={saveDefaultHosts}
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  >
                    {saving ? "Saving..." : "Save & Reprocess"}
                  </button>
                )}
              </div>
              {saveResult && <div className="mb-4 p-3 bg-white dark:bg-slate-800 rounded-lg text-sm dark:text-slate-100">{saveResult}</div>}
              <div className="space-y-2">
                {[...staged].map(([typeId, member]) => (
                  <div key={typeId} className="p-3 bg-white dark:bg-slate-800 rounded-lg dark:text-slate-100">
                    <span className="text-plum-600 dark:text-plum-400">{stats.find((s) => s.typeId === typeId)?.typeName}</span>
                    <span className="mx-2 text-gray-500">→</span>
                    <span className="font-semibold">{member?.name ?? "No default host"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 dark:text-slate-100">Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">Data Quality Issues</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{totalUnexpected}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">prickles requiring hosts</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-slate-400">Expected (No Host Required)</p>
                <p className="text-2xl font-bold text-gray-600 dark:text-slate-400">
                  {expectedUnhosted.reduce((sum, s) => sum + s.missingCount, 0)}
                </p>
                <p className="text-sm text-gray-500 dark:text-slate-400">prickles intentionally unhosted</p>
              </div>
            </div>

            {/* Collapsible Detailed Breakdown */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button
                  onClick={() => setShowDetailedStats(!showDetailedStats)}
                  className="text-sm text-plum-600 dark:text-plum-400 hover:text-plum-700 dark:hover:text-plum-300 flex items-center gap-1"
                >
                  {showDetailedStats ? '▼' : '▶'} Detailed Breakdown
                </button>
                {showDetailedStats && (
                  <div className="mt-3 text-sm space-y-1 font-mono text-gray-700 dark:text-slate-300">
                    <div>Total calendar Prickles: {detailedStats.total.toLocaleString()}</div>
                    <div>With hosts: {detailedStats.withHost.toLocaleString()} ({detailedStats.withHostRequiring.toLocaleString()} requiring + {detailedStats.withHostNotRequiring.toLocaleString()} not requiring)</div>
                    <div>Without hosts: {detailedStats.withoutHost.toLocaleString()} ({detailedStats.withoutHostRequiring.toLocaleString()} requiring + {detailedStats.withoutHostNotRequiring.toLocaleString()} not requiring)</div>
                    <div className="pt-1 border-t border-gray-200 dark:border-slate-700">Requiring hosts: {(detailedStats.withHostRequiring + detailedStats.withoutHostRequiring).toLocaleString()} ({detailedStats.withHostRequiring.toLocaleString()} with + {detailedStats.withoutHostRequiring.toLocaleString()} without)</div>
                    <div>Not requiring hosts: {(detailedStats.withHostNotRequiring + detailedStats.withoutHostNotRequiring).toLocaleString()} ({detailedStats.withHostNotRequiring.toLocaleString()} with + {detailedStats.withoutHostNotRequiring.toLocaleString()} without)</div>
                  </div>
                )}
              </div>
          </div>

          {/* Data Quality Issues */}
          {unexpectedUnhosted.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-orange-600 dark:text-orange-400">
                ⚠️ Missing Hosts (Data Quality Issues)
              </h2>
              <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                These prickle types should have hosts but don't. Click to investigate.
              </p>
              <div className="space-y-2">
                {unexpectedUnhosted.map((stat) => (
                  <div
                    key={stat.typeId}
                    className="p-3 bg-orange-50 dark:bg-orange-900/20 border dark:border-orange-800/30 rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium dark:text-slate-100">{stat.typeName}</p>
                        <p className="text-sm text-gray-600 dark:text-slate-400">
                          {stat.missingCount} prickles missing hosts
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedType(stat.typeId)}
                        className="text-xs px-3 py-1 bg-white dark:bg-slate-700 border dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-600 dark:text-slate-200"
                      >
                        View
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <MemberSearch
                        members={activeMembers}
                        selectedMemberId={staged.has(stat.typeId) ? (staged.get(stat.typeId)?.id ?? null) : stat.defaultHostId}
                        selectedMemberName={staged.has(stat.typeId) ? (staged.get(stat.typeId)?.name ?? null) : stat.defaultHostName}
                        onSelect={(member) => stageDefaultHost(stat.typeId, stat.defaultHostId, member)}
                        className="flex-1"
                      />
                      <button
                        onClick={() => toggleRequiresHost(stat.typeId, stat.requiresHost)}
                        className="text-xs px-3 py-1 bg-white dark:bg-slate-700 border dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-600 dark:text-slate-200 whitespace-nowrap"
                      >
                        Mark Optional
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expected Unhosted */}
          {expectedUnhosted.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 dark:text-slate-100">
                ✓ Expected Unhosted Prickles
              </h2>
              <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                These prickle types don't require hosts (community events, self-directed time, etc.)
              </p>
              <div className="space-y-2">
                {expectedUnhosted.map((stat) => (
                  <div
                    key={stat.typeId}
                    className="p-3 bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600/50 rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-gray-700 dark:text-slate-200">{stat.typeName}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">
                          {stat.missingCount} prickles (host not required)
                        </p>
                      </div>
                      <button
                        onClick={() => toggleRequiresHost(stat.typeId, stat.requiresHost)}
                        className="text-xs px-3 py-1 bg-white dark:bg-slate-700 border dark:border-slate-600 rounded hover:bg-gray-50 dark:hover:bg-slate-600 dark:text-slate-200 whitespace-nowrap"
                      >
                        Mark Required
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <MemberSearch
                        members={activeMembers}
                        selectedMemberId={staged.has(stat.typeId) ? (staged.get(stat.typeId)?.id ?? null) : stat.defaultHostId}
                        selectedMemberName={staged.has(stat.typeId) ? (staged.get(stat.typeId)?.name ?? null) : stat.defaultHostName}
                        onSelect={(member) => stageDefaultHost(stat.typeId, stat.defaultHostId, member)}
                        className="flex-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detail View */}
          {selectedType && (
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold dark:text-slate-100">
                  {stats.find((s) => s.typeId === selectedType)?.typeName} - Missing Hosts
                </h2>
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
                >
                  Close
                </button>
              </div>

              {(() => {
                const count = stats.find((s) => s.typeId === selectedType)?.missingCount ?? prickles.length;
                return (
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">
                      Nobody hosts this any more? Credit one member as the host of all {count}, so the past ones say who hosted. Former members can be picked.
                    </p>
                    <div className="flex items-center gap-2">
                      <MemberSearch
                        members={members}
                        selectedMemberId={bulkHost?.id ?? null}
                        selectedMemberName={bulkHost?.name}
                        onSelect={(member) => {
                          setAssignResult(null);
                          setBulkHost(member ? { id: member.id, name: member.displayName?.trim() || member.name } : null);
                        }}
                        placeholder="Search for the host..."
                        className="flex-1"
                      />
                      <button
                        onClick={() => assignAll(selectedType, count)}
                        disabled={!bulkHost || assigning}
                        className="text-sm px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        {assigning ? "Assigning..." : `Assign to all ${count}`}
                      </button>
                    </div>
                    {assignResult && <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">{assignResult}</p>}
                  </div>
                );
              })()}

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {prickles.map((prickle) => (
                  <Link
                    key={prickle.id}
                    href={`/admin/prickles/${prickle.id}`}
                    className="block p-3 bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600/50 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <p className="font-medium dark:text-slate-100">
                      {prickle.title || prickle.typeName}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                      {formatDateTimeRange(prickle.startTime, prickle.endTime, timeZone)}
                    </p>
                  </Link>
                ))}
              </div>

              {prickles.length === UNHOSTED_LIST_LIMIT && (
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-4">Showing first 100 prickles</p>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
