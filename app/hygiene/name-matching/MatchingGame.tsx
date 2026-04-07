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
}

interface Match {
  zoomName: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
}

export default function MatchingGame({
  unmatchedAttendees,
  membersWithNoAttendance,
}: {
  unmatchedAttendees: UnmatchedAttendee[];
  membersWithNoAttendance: Member[];
}) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  // Remove matched items from the lists
  const availableZoomNames = unmatchedAttendees.filter(
    (a) => !matches.some((m) => m.zoomName === a.zoomName)
  );
  const availableMembers = membersWithNoAttendance.filter(
    (m) => !matches.some((match) => match.memberId === m.id)
  );

  const handleDragStart = (zoomName: string) => {
    setDraggedItem(zoomName);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (member: Member) => {
    if (draggedItem) {
      const attendee = unmatchedAttendees.find((a) => a.zoomName === draggedItem);
      if (attendee) {
        setMatches([
          ...matches,
          {
            zoomName: draggedItem,
            memberId: member.id,
            memberName: member.name,
            memberEmail: member.email,
          },
        ]);
      }
      setDraggedItem(null);
    }
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

      {/* Matching Game */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left: Unmatched Zoom Names */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold">Unmatched Zoom Names</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Drag these to the right to create matches
            </p>
            <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
              {availableZoomNames.length}
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {availableZoomNames.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                All matched! 🎉
              </div>
            ) : (
              availableZoomNames.map((attendee) => (
                <div
                  key={attendee.zoomName}
                  draggable
                  onDragStart={() => handleDragStart(attendee.zoomName)}
                  className="p-4 cursor-move hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
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
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Members with No Attendance */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold">Members Needing Match</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Drop Zoom names here
            </p>
            <div className="mt-2 text-2xl font-bold text-orange-600 dark:text-orange-400">
              {availableMembers.length}
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {availableMembers.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                All matched! 🎉
              </div>
            ) : (
              availableMembers.map((member) => (
                <div
                  key={member.id}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(member)}
                  className={`p-4 transition-colors ${
                    draggedItem
                      ? "bg-green-50 dark:bg-green-900/20 border-2 border-dashed border-green-400"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {member.name}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {member.email}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>How to match:</strong> Drag a Zoom name from the left and drop it onto the
          corresponding member on the right. When you're done, click "Save Aliases" to add them to
          the database.
        </p>
      </div>
    </div>
  );
}
