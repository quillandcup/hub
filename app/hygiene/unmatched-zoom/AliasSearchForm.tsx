"use client";

import { useState } from "react";
import MemberSearch from "@/components/MemberSearch";
import Modal from "@/components/Modal";
import { formatDateTime } from "@/lib/formatters";

interface UnmatchedAttendee {
  zoomName: string;
  appearances: number;
  emails: string[];
}

interface Member {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface Match {
  zoomName: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
}

export default function AliasSearchForm({
  unmatchedAttendees,
  allMembers,
}: {
  unmatchedAttendees: UnmatchedAttendee[];
  allMembers: Member[];
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [ignoredNames, setIgnoredNames] = useState<Set<string>>(new Set());
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [prickleModalOpen, setPrickleModalOpen] = useState(false);
  const [selectedZoomName, setSelectedZoomName] = useState<string | null>(null);
  const [prickles, setPrickles] = useState<any[]>([]);
  const [loadingPrickles, setLoadingPrickles] = useState(false);

  // Remove matched and ignored items from the list
  const availableZoomNames = unmatchedAttendees.filter(
    (a) => !matches.some((m) => m.zoomName === a.zoomName) && !ignoredNames.has(a.zoomName)
  );

  const handleSelectMember = (zoomName: string, member: Member | null) => {
    if (!member) return; // Don't add null matches

    setMatches([
      ...matches,
      {
        zoomName,
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
      },
    ]);
  };

  const handleRemoveMatch = (zoomName: string) => {
    setMatches(matches.filter((m) => m.zoomName !== zoomName));
  };

  const handleSaveMatches = async () => {
    setSaving(true);
    setSaveResult(null);

    try {
      const response = await fetch("/api/aliases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ matches }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save aliases");
      }

      setSaveResult(`✓ Saved ${data.inserted} aliases!`);

      // Clear matches after successful save
      setTimeout(() => {
        setMatches([]);
        setSaveResult(null);
      }, 2000);
    } catch (error: any) {
      setSaveResult(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleIgnore = async (zoomName: string) => {
    const reason = prompt(`Why are you ignoring "${zoomName}"?\n(Optional - press OK to skip)`);
    if (reason === null) return; // User cancelled

    setIgnoring(zoomName);

    try {
      const response = await fetch("/api/zoom/ignore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ zoomName, reason: reason || null }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to ignore name");
      }

      setIgnoredNames(new Set([...ignoredNames, zoomName]));
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setIgnoring(null);
    }
  };

  const handleViewPrickles = async (zoomName: string) => {
    setSelectedZoomName(zoomName);
    setPrickleModalOpen(true);
    setLoadingPrickles(true);

    try {
      // Fetch prickles where this Zoom name appeared
      const response = await fetch(`/api/zoom/prickles?zoomName=${encodeURIComponent(zoomName)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch prickles");
      }

      setPrickles(data.prickles || []);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
      setPrickleModalOpen(false);
    } finally {
      setLoadingPrickles(false);
    }
  };


  return (
    <div className="space-y-6">
      {/* Matches Made */}
      {matches.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-green-800 dark:text-green-200">
              Matches Created ({matches.length})
            </h3>
            <button
              onClick={handleSaveMatches}
              disabled={saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              {saving ? "Saving..." : "Save Aliases"}
            </button>
          </div>

          {saveResult && (
            <div className="mb-4 p-3 bg-white dark:bg-slate-800 rounded-lg text-sm">
              {saveResult}
            </div>
          )}

          <div className="space-y-2">
            {matches.map((match) => (
              <div
                key={match.zoomName}
                className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="text-sm">
                    <span className="font-mono text-blue-600 dark:text-blue-400">
                      {match.zoomName}
                    </span>
                    <span className="mx-2 text-slate-400">→</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {match.memberName}
                    </span>
                    <span className="text-slate-500 text-xs ml-2">
                      ({match.memberEmail})
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveMatch(match.zoomName)}
                  className="text-red-600 dark:text-red-400 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search-based matching */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-lg font-bold">Unmatched Zoom Names</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Search for a member to create an alias
          </p>
          <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
            {availableZoomNames.length}
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[800px] overflow-y-auto">
          {availableZoomNames.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              All matched! 🎉
            </div>
          ) : (
            availableZoomNames.map((attendee) => (
              <div key={attendee.zoomName} className="p-3">
                <div className="grid grid-cols-[300px_1fr_auto] gap-4 items-start">
                  {/* Left: Name and metadata */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        &quot;{attendee.zoomName}&quot;
                      </span>
                      {attendee.zoomName !== attendee.zoomName.trim() && (
                        <span className="text-xs px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded">
                          whitespace
                        </span>
                      )}
                      {/[^\x00-\x7F]/.test(attendee.zoomName) && (
                        <span className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                          special chars
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {attendee.zoomName.length} chars •{" "}
                      <button
                        onClick={() => handleViewPrickles(attendee.zoomName)}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {attendee.appearances} appearances
                      </button>
                    </div>
                    {attendee.emails.length > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {attendee.emails.join(", ")}
                      </div>
                    )}
                  </div>

                  {/* Middle: Member search */}
                  <MemberSearch
                    members={allMembers}
                    selectedMemberId={null}
                    onSelect={(member) => handleSelectMember(attendee.zoomName, member)}
                  />

                  {/* Right: Ignore button */}
                  <div>
                    <button
                      onClick={() => handleIgnore(attendee.zoomName)}
                      disabled={ignoring === attendee.zoomName}
                      className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 rounded disabled:opacity-50"
                    >
                      {ignoring === attendee.zoomName ? "Ignoring..." : "Ignore"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Prickle Modal */}
      <Modal
        isOpen={prickleModalOpen}
        onClose={() => setPrickleModalOpen(false)}
        title={`Prickles for "${selectedZoomName}"`}
      >
        {loadingPrickles ? (
          <div className="text-center text-slate-500 py-8">Loading...</div>
        ) : prickles.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-slate-500 mb-4">No prickles found</div>
            <div className="text-sm text-slate-400 max-w-md mx-auto">
              This Zoom name appeared in meetings that weren&apos;t processed into prickles yet.
              Try reprocessing attendance data to include these meetings.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {prickles.map((prickle: any) => (
              <a
                key={prickle.id}
                href={`/dashboard/prickles/${prickle.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {prickle.type_name || "Unknown Type"}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      {formatDateTime(prickle.start_time)}
                    </div>
                  </div>
                  <div className="text-blue-600 dark:text-blue-400">→</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </Modal>

      {/* Instructions */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>How to match:</strong> Type in the search box to find a member by name or email.
          This allows you to match Zoom names to ANY member in the system, including those who
          already have attendance records. When you're done, click "Save Aliases" to add them to
          the database.
        </p>
      </div>
    </div>
  );
}
