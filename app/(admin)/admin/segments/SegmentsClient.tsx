"use client";

import { useState, useEffect, useCallback } from "react";

interface Segment {
  id: string;
  name: string;
  created_at: string;
  memberCount: number;
}

interface SegmentMember {
  id: string;
  name: string;
  email: string;
}

interface MemberAddResult {
  email: string;
  status: "added" | "already_in_segment" | "not_found";
}

interface InviteResult {
  email: string;
  status: "invited" | "skipped" | "failed";
  error?: string;
}

interface FlagSegmentLink {
  id: string;
  name: string;
}

interface FlagRow {
  key: string;
  name: string;
  enabledGlobally: boolean;
  segments: FlagSegmentLink[];
}

const RESULT_COLORS: Record<string, string> = {
  added: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  invited: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  already_in_segment: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  skipped: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  not_found: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function SegmentsClient() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [activeSegment, setActiveSegment] = useState<Segment | null>(null);
  const [members, setMembers] = useState<SegmentMember[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [addResults, setAddResults] = useState<MemberAddResult[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteResults, setInviteResults] = useState<InviteResult[] | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [attachSegmentByKey, setAttachSegmentByKey] = useState<Record<string, string>>({});

  const fetchSegments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/segments");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load segments");
      setSegments(data.segments);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load segments");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFlags = useCallback(async () => {
    setFlagsLoading(true);
    try {
      const res = await fetch("/api/admin/feature-flags");
      const data = await res.json();
      if (res.ok) setFlags(data.flags);
    } finally {
      setFlagsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSegments();
    fetchFlags();
  }, [fetchSegments, fetchFlags]);

  async function createSegment(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create segment");
      setNewName("");
      await fetchSegments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to create segment");
    } finally {
      setCreating(false);
    }
  }

  async function deleteSegment(segment: Segment) {
    if (!confirm(`Delete segment "${segment.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/segments/${segment.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete segment");
      await Promise.all([fetchSegments(), fetchFlags()]);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete segment");
    }
  }

  async function openSegment(segment: Segment) {
    setActiveSegment(segment);
    setPasteText("");
    setAddResults(null);
    setInviteResults(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/segments/${segment.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load segment");
      setMembers(data.members);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : "Failed to load segment");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeSegment() {
    setActiveSegment(null);
    setMembers([]);
  }

  async function addMembers() {
    if (!activeSegment || !pasteText.trim()) return;
    setAdding(true);
    setAddResults(null);
    try {
      const res = await fetch(`/api/admin/segments/${activeSegment.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add members");
      setAddResults(data.results);
      setPasteText("");
      const refreshed = await fetch(`/api/admin/segments/${activeSegment.id}`).then((r) => r.json());
      setMembers(refreshed.members);
      await fetchSegments();
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : "Failed to add members");
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(memberId: string) {
    if (!activeSegment) return;
    try {
      const res = await fetch(`/api/admin/segments/${activeSegment.id}/members/${memberId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove member");
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      await fetchSegments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function inviteSegment() {
    if (!activeSegment) return;
    if (!confirm(`Invite everyone in "${activeSegment.name}" who doesn't already have an account?`)) return;
    setInviting(true);
    setInviteResults(null);
    try {
      const res = await fetch(`/api/admin/segments/${activeSegment.id}/invite`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to invite segment");
      setInviteResults(data.results);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : "Failed to invite segment");
    } finally {
      setInviting(false);
    }
  }

  async function toggleGlobal(key: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/admin/feature-flags/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledGlobally: enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update flag");
      await fetchFlags();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update flag");
    }
  }

  async function attachSegmentToFlag(key: string) {
    const segmentId = attachSegmentByKey[key];
    if (!segmentId) return;
    try {
      const res = await fetch(`/api/admin/feature-flags/${key}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to attach segment");
      setAttachSegmentByKey((prev) => ({ ...prev, [key]: "" }));
      await fetchFlags();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to attach segment");
    }
  }

  async function detachSegmentFromFlag(key: string, segmentId: string) {
    try {
      const res = await fetch(`/api/admin/feature-flags/${key}/segments/${segmentId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to detach segment");
      await fetchFlags();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to detach segment");
    }
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Segments</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Manually-curated member groups for phased rollouts — bulk invites and targeted feature flags
        </p>
      </div>

      <div className="mb-6 bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">New Segment</h2>
        <form onSubmit={createSegment} className="flex gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Founding Hedgies"
            required
            className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
          />
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {creating ? "Creating..." : "Create Segment"}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">{loading ? "Loading..." : `Segments (${segments.length})`}</h2>
        </div>
        {error && <div className="p-6 text-red-600 dark:text-red-400">{error}</div>}
        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Members</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {segments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                      No segments yet.
                    </td>
                  </tr>
                )}
                {segments.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{s.memberCount}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openSegment(s)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                          Manage
                        </button>
                        <button onClick={() => deleteSegment(s)} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Feature Flag Targeting</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Turn a flag on for everyone, or roll it out to just a segment
          </p>
        </div>
        {flagsLoading ? (
          <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading...</div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {flags.map((f) => (
              <div key={f.key} className="px-6 py-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{f.name}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 font-mono">{f.key}</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={f.enabledGlobally}
                      onChange={(e) => toggleGlobal(f.key, e.target.checked)}
                      className="rounded"
                    />
                    Enabled for everyone
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {f.segments.length === 0 ? (
                    <span className="text-xs text-slate-400 dark:text-slate-500">No segments targeted</span>
                  ) : (
                    f.segments.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                      >
                        {s.name}
                        <button
                          onClick={() => detachSegmentFromFlag(f.key, s.id)}
                          className="hover:text-purple-900 dark:hover:text-purple-100"
                          aria-label={`Remove ${s.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                  <select
                    value={attachSegmentByKey[f.key] ?? ""}
                    onChange={(e) => setAttachSegmentByKey((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="">Add segment...</option>
                    {segments
                      .filter((s) => !f.segments.some((fs) => fs.id === s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => attachSegmentToFlag(f.key)}
                    disabled={!attachSegmentByKey[f.key]}
                    className="text-xs px-2 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-300 rounded font-medium transition-colors"
                  >
                    Attach
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeSegment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={closeSegment}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-lg shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold">{activeSegment.name}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">{members.length} members</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={inviteSegment}
                  disabled={inviting || members.length === 0}
                  className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded font-medium transition-colors"
                >
                  {inviting ? "Inviting..." : "Bulk Invite"}
                </button>
                <button onClick={closeSegment} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            {detailError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{detailError}</p>}

            <div className="mb-4">
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                Add members by email (comma, space, or newline separated)
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={3}
                placeholder="alice@example.com, bob@example.com"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono"
              />
              <button
                onClick={addMembers}
                disabled={adding || !pasteText.trim()}
                className="mt-2 text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded font-medium transition-colors"
              >
                {adding ? "Adding..." : "Add to Segment"}
              </button>
            </div>

            {addResults && (
              <div className="mb-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Add results:</p>
                <ul className="flex flex-wrap gap-1">
                  {addResults.map((r) => (
                    <li key={r.email} className={`px-2 py-0.5 rounded text-xs font-medium ${RESULT_COLORS[r.status]}`}>
                      {r.email}: {r.status.replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {inviteResults && (
              <div className="mb-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Invite results:</p>
                <ul className="flex flex-wrap gap-1">
                  {inviteResults.map((r) => (
                    <li
                      key={r.email}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${RESULT_COLORS[r.status]}`}
                      title={r.error}
                    >
                      {r.email}: {r.status}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Members</p>
              {detailLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
              ) : members.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No members yet.</p>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                  {members.map((m) => (
                    <li key={m.id} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="text-sm text-slate-900 dark:text-slate-100">{m.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{m.email}</div>
                      </div>
                      <button
                        onClick={() => removeMember(m.id)}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
