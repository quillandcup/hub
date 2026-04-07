"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface EventGroup {
  summary: string;
  count: number;
  eventIds: string[];
  calendarEventIds: string[];
  suggestedType: string | null;
  suggestedHost: string | null;
}

interface PrickleType {
  id: string;
  name: string;
  normalized_name: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
}

interface UnmatchedEventsTableProps {
  eventGroups: EventGroup[];
  prickleTypes: PrickleType[];
}

export default function UnmatchedEventsTable({
  eventGroups,
  prickleTypes,
}: UnmatchedEventsTableProps) {
  const router = useRouter();
  const [selectedGroup, setSelectedGroup] = useState<EventGroup | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedTypeId, setSelectedTypeId] = useState(prickleTypes[0]?.id || "");
  const [newTypeName, setNewTypeName] = useState("");
  const [host, setHost] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [hostSearchTerm, setHostSearchTerm] = useState("");
  const [showHostDropdown, setShowHostDropdown] = useState(false);

  // Fetch members when component mounts
  useEffect(() => {
    const fetchMembers = async () => {
      setLoadingMembers(true);
      try {
        const response = await fetch("/api/members");
        if (response.ok) {
          const data = await response.json();
          setMembers(data.members || []);
        }
      } catch (err) {
        console.error("Failed to fetch members:", err);
      } finally {
        setLoadingMembers(false);
      }
    };
    fetchMembers();
  }, []);

  const openModal = (group: EventGroup) => {
    setSelectedGroup(group);
    setMode("existing");
    setSelectedTypeId(prickleTypes[0]?.id || "");
    setNewTypeName(group.suggestedType || "");
    setHost(group.suggestedHost || "");
    setHostSearchTerm(group.suggestedHost || "");
    setError(null);
  };

  const closeModal = () => {
    setSelectedGroup(null);
    setError(null);
    setLoading(false);
  };

  // Filter members based on search term
  const filteredMembers = members.filter(
    (member) =>
      member.name.toLowerCase().includes(hostSearchTerm.toLowerCase()) ||
      member.email.toLowerCase().includes(hostSearchTerm.toLowerCase())
  );

  const handleHostSelect = (memberName: string) => {
    setHost(memberName);
    setHostSearchTerm(memberName);
    setShowHostDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/prickle-types/resolve-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unmatchedEventIds: selectedGroup.eventIds,
          calendarEventIds: selectedGroup.calendarEventIds,
          mode,
          typeId: mode === "existing" ? selectedTypeId : null,
          newTypeName: mode === "new" ? newTypeName : null,
          host,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to resolve events");
      }

      // Success - close modal and refresh
      closeModal();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleIgnore = async (group: EventGroup) => {
    if (!confirm(`Are you sure you want to ignore ${group.count} event(s) with this title?`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/prickle-types/ignore-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unmatchedEventIds: group.eventIds }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to ignore events");
      }

      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Event Summary
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Count
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Suggested Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Suggested Host
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {eventGroups.map((group, idx) => (
              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {group.summary}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {group.count} event{group.count > 1 ? "s" : ""}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {group.suggestedType || "—"}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {group.suggestedHost || "—"}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => openModal(group)}
                      className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    >
                      Review
                    </button>
                    <button
                      onClick={() => handleIgnore(group)}
                      className="text-xs px-3 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded transition-colors"
                    >
                      Ignore
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-xl font-bold">Categorize Event</h2>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4">
              {/* Event Details */}
              <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Event Summary
                </div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  {selectedGroup.summary}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Will apply to {selectedGroup.count} event{selectedGroup.count > 1 ? "s" : ""}
                </div>
              </div>

              {error && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                {/* Mode Selection */}
                <div className="mb-6">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                    Prickle Type
                  </label>
                  <div className="flex gap-4 mb-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="mode"
                        value="existing"
                        checked={mode === "existing"}
                        onChange={() => setMode("existing")}
                        className="mr-2"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Use existing type</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="mode"
                        value="new"
                        checked={mode === "new"}
                        onChange={() => setMode("new")}
                        className="mr-2"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Create new type</span>
                    </label>
                  </div>

                  {mode === "existing" ? (
                    <select
                      value={selectedTypeId}
                      onChange={(e) => setSelectedTypeId(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      required
                    >
                      {prickleTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder="e.g., Pitch Prickle, Workshop Prickle"
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      required
                    />
                  )}
                </div>

                {/* Host */}
                <div className="mb-6 relative">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                    Host <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">(optional - leave empty for community events)</span>
                  </label>
                  <input
                    type="text"
                    value={hostSearchTerm}
                    onChange={(e) => {
                      setHostSearchTerm(e.target.value);
                      setHost(e.target.value);
                      setShowHostDropdown(true);
                    }}
                    onFocus={() => setShowHostDropdown(true)}
                    onBlur={() => {
                      // Delay to allow click on dropdown item
                      setTimeout(() => setShowHostDropdown(false), 200);
                    }}
                    placeholder="Search for a member or leave empty..."
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  {showHostDropdown && filteredMembers.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg">
                      {filteredMembers.slice(0, 10).map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => handleHostSelect(member.name)}
                          className="w-full px-4 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100"
                        >
                          <div className="font-medium">{member.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {member.email}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {loadingMembers && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Loading members...
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                  >
                    {loading ? "Saving..." : `Create ${selectedGroup.count} Prickle${selectedGroup.count > 1 ? "s" : ""}`}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={loading}
                    className="px-6 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:bg-slate-300 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
