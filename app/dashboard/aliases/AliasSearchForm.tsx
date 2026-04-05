"use client";

import { useState } from "react";

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
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [focusedSearch, setFocusedSearch] = useState<string | null>(null);

  // Remove matched items from the list
  const availableZoomNames = unmatchedAttendees.filter(
    (a) => !matches.some((m) => m.zoomName === a.zoomName)
  );

  const handleSearchChange = (zoomName: string, value: string) => {
    setSearchTerms({ ...searchTerms, [zoomName]: value });
    setFocusedSearch(zoomName);
  };

  const handleSelectMember = (zoomName: string, member: Member) => {
    setMatches([
      ...matches,
      {
        zoomName,
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
      },
    ]);
    setSearchTerms({ ...searchTerms, [zoomName]: "" });
    setFocusedSearch(null);
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

  // Filter members based on search term
  const getFilteredMembers = (zoomName: string) => {
    const searchTerm = searchTerms[zoomName]?.toLowerCase() || "";
    if (!searchTerm) return [];

    return allMembers
      .filter(
        (m) =>
          m.name.toLowerCase().includes(searchTerm) ||
          m.email.toLowerCase().includes(searchTerm)
      )
      .slice(0, 10); // Limit to 10 results
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
            availableZoomNames.map((attendee) => {
              const filteredMembers = getFilteredMembers(attendee.zoomName);
              const showDropdown =
                focusedSearch === attendee.zoomName && filteredMembers.length > 0;

              return (
                <div key={attendee.zoomName} className="p-4">
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {attendee.zoomName}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {attendee.appearances} appearances
                  </div>
                  {attendee.emails.length > 0 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {attendee.emails.join(", ")}
                    </div>
                  )}

                  {/* Search input */}
                  <div className="mt-3 relative">
                    <input
                      type="text"
                      placeholder="Search for member..."
                      value={searchTerms[attendee.zoomName] || ""}
                      onChange={(e) =>
                        handleSearchChange(attendee.zoomName, e.target.value)
                      }
                      onFocus={() => setFocusedSearch(attendee.zoomName)}
                      onBlur={() => {
                        // Delay to allow click on dropdown
                        setTimeout(() => setFocusedSearch(null), 200);
                      }}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />

                    {/* Dropdown */}
                    {showDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredMembers.map((member) => (
                          <button
                            key={member.id}
                            onClick={() => handleSelectMember(attendee.zoomName, member)}
                            className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700 border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                          >
                            <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                              {member.name}
                            </div>
                            <div className="text-xs text-slate-600 dark:text-slate-400">
                              {member.email}
                              <span className="ml-2 text-slate-500">({member.status})</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

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
