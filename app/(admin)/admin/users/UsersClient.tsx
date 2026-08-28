"use client";

import { useState, useEffect, useCallback } from "react";
import { FEATURE_PREVIEWS } from "@/lib/features";

type Role = "admin" | "assistant" | "member";
type StaffRole = "owner" | "staff" | "contractor";

interface StaffRecord {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  user_id: string | null;
}

interface AppUser {
  id: string;
  email: string;
  role: Role;
  features: string[];
  createdAt: string;
  staffId: string | null;
  staffName: string | null;
  staffRole: StaffRole | null;
  memberId: string | null;
  memberName: string | null;
  pending: boolean;
}

interface AccessSession {
  session_start: string;
  session_end: string;
  event_count: number;
  pages: string[] | null;
  auth_session_id: string | null;
  session_active: boolean;
  auth_session_created_at: string | null;
}

const ET_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function formatSessionRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startLabel = `${ET_DATE_FORMAT.format(startDate)}, ${ET_TIME_FORMAT.format(startDate)}`;
  if (startDate.getTime() === endDate.getTime()) return startLabel;
  return `${startLabel} – ${ET_TIME_FORMAT.format(endDate)}`;
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  assistant: "Assistant",
  member: "Member",
};

const ROLE_COLORS: Record<Role, string> = {
  admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  assistant: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  member: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
};

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  staff: "Staff",
  contractor: "Contractor",
};

const STAFF_ROLE_COLORS: Record<StaffRole, string> = {
  owner: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  staff: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  contractor: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

export default function UsersClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [allStaff, setAllStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("member");
  const [editFeatures, setEditFeatures] = useState<Set<string>>(new Set());
  const [editStaffId, setEditStaffId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resentId, setResentId] = useState<string | null>(null);

  const [historyUser, setHistoryUser] = useState<AppUser | null>(null);
  const [historySessions, setHistorySessions] = useState<AccessSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(data.users);
      setAllStaff(data.allStaff ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function startEdit(user: AppUser) {
    setEditingId(user.id);
    setEditRole(user.role);
    setEditFeatures(new Set(user.features));
    setEditStaffId(user.staffId);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(userId: string, originalStaffId: string | null) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        role: editRole,
        features: Array.from(editFeatures),
      };
      // Only include staffId if it changed
      if (editStaffId !== originalStaffId) {
        body.staffId = editStaffId;
      }
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setEditingId(null);
      await fetchUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  function toggleFeature(key: string) {
    setEditFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to invite user");
      setInviteEmail("");
      setShowInviteForm(false);
      await fetchUsers();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Failed to invite user");
    } finally {
      setInviting(false);
    }
  }

  async function handleDelete(userId: string) {
    setDeletingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      setConfirmDeleteId(null);
      await fetchUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }

  async function loadHistory(userId: string) {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/access-history`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load access history");
      setHistorySessions(data.sessions);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load access history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistory(user: AppUser) {
    setHistoryUser(user);
    setHistorySessions([]);
    setRevokeError(null);
    loadHistory(user.id);
  }

  function closeHistory() {
    setHistoryUser(null);
    setHistorySessions([]);
    setHistoryError(null);
    setRevokeError(null);
  }

  async function handleRevokeSessions() {
    if (!historyUser) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const res = await fetch(`/api/admin/users/${historyUser.id}/revoke-sessions`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sign out sessions");
      await loadHistory(historyUser.id);
    } catch (err: unknown) {
      setRevokeError(err instanceof Error ? err.message : "Failed to sign out sessions");
    } finally {
      setRevoking(false);
    }
  }

  async function handleResend(userId: string) {
    setResendingId(userId);
    setResentId(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/resend`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend invite");
      setResentId(userId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to resend invite");
    } finally {
      setResendingId(null);
    }
  }

  function availableStaffOptions(currentStaffId: string | null): StaffRecord[] {
    return allStaff.filter((s) => s.user_id === null || s.id === currentStaffId);
  }

  return (
    <>
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage user accounts, roles, and feature access
          </p>
        </div>
        <button
          onClick={() => { setShowInviteForm(!showInviteForm); setInviteError(null); }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Invite User
        </button>
      </div>

      {showInviteForm && (
        <div className="mb-6 bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Invite New User</h2>
          {inviteError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
              {inviteError}
            </div>
          )}
          <form onSubmit={handleInvite} className="flex gap-3">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              required
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
            />
            <button
              type="submit"
              disabled={inviting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {inviting ? "Sending..." : "Send Invite"}
            </button>
            <button
              type="button"
              onClick={() => setShowInviteForm(false)}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">
            {loading ? "Loading..." : `All Users (${users.length})`}
          </h2>
        </div>

        {error && (
          <div className="p-6 text-red-600 dark:text-red-400">{error}</div>
        )}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Linked Profiles
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Feature Flags
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {users.map((user) => {
                  const isEditing = editingId === user.id;
                  const isCurrentUser = user.id === currentUserId;
                  const staffOptions = availableStaffOptions(user.staffId);

                  return (
                    <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {user.email}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">(you)</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value as Role)}
                            className="px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
                          >
                            <option value="admin">Admin</option>
                            <option value="assistant">Assistant</option>
                            <option value="member">Member</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role]}`}>
                            {ROLE_LABELS[user.role]}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <div>
                              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Staff</label>
                              <select
                                value={editStaffId ?? ""}
                                onChange={(e) => setEditStaffId(e.target.value || null)}
                                className="px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm w-full"
                              >
                                <option value="">— None —</option>
                                {staffOptions.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} ({STAFF_ROLE_LABELS[s.role]})
                                  </option>
                                ))}
                              </select>
                            </div>
                            {user.memberId && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                Member: <span className="font-medium text-slate-700 dark:text-slate-300">{user.memberName}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {user.staffId ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STAFF_ROLE_COLORS[user.staffRole!]}`}>
                                {user.staffName} · {STAFF_ROLE_LABELS[user.staffRole!]}
                              </span>
                            ) : null}
                            {user.memberId ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                Member: {user.memberName}
                              </span>
                            ) : null}
                            {!user.staffId && !user.memberId && (
                              <span className="text-xs text-slate-400 dark:text-slate-500">None</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            {FEATURE_PREVIEWS.map((f) => (
                              <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editFeatures.has(f.key)}
                                  onChange={() => toggleFeature(f.key)}
                                  className="rounded"
                                />
                                {f.name}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {user.features.length === 0 ? (
                              <span className="text-xs text-slate-400 dark:text-slate-500">None</span>
                            ) : (
                              user.features.map((key) => {
                                const feature = FEATURE_PREVIEWS.find((f) => f.key === key);
                                return (
                                  <span
                                    key={key}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                    title={feature?.description}
                                  >
                                    {feature?.name ?? key}
                                  </span>
                                );
                              })
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(user.id, user.staffId)}
                                disabled={saving}
                                className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded font-medium transition-colors"
                              >
                                {saving ? "Saving..." : "Save"}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={saving}
                                className="text-xs px-3 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded font-medium transition-colors"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(user)}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => openHistory(user)}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Activity
                              </button>
                              {user.pending && (
                                <button
                                  onClick={() => handleResend(user.id)}
                                  disabled={resendingId === user.id}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                >
                                  {resendingId === user.id
                                    ? "Sending..."
                                    : resentId === user.id
                                      ? "Sent!"
                                      : "Resend Invite"}
                                </button>
                              )}
                              {!isCurrentUser && (
                                confirmDeleteId === user.id ? (
                                  <>
                                    <button
                                      onClick={() => handleDelete(user.id)}
                                      disabled={deletingId === user.id}
                                      className="text-xs px-2 py-0.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded font-medium transition-colors"
                                    >
                                      {deletingId === user.id ? "Deleting..." : "Confirm"}
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(user.id)}
                                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                                  >
                                    Delete
                                  </button>
                                )
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

    {historyUser && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        onClick={closeHistory}
      >
        <div
          className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-lg shadow-xl p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">Activity</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">{historyUser.email}</p>
            </div>
            <div className="flex items-center gap-3">
              {historyUser.id !== currentUserId && (
                <button
                  onClick={handleRevokeSessions}
                  disabled={revoking}
                  className="text-xs px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded font-medium transition-colors"
                >
                  {revoking ? "Signing out..." : "Force sign-out"}
                </button>
              )}
              <button
                onClick={closeHistory}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {revokeError && (
            <p className="mb-4 text-sm text-red-600 dark:text-red-400">{revokeError}</p>
          )}

          {historyLoading && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          )}

          {historyError && (
            <p className="text-sm text-red-600 dark:text-red-400">{historyError}</p>
          )}

          {!historyLoading && !historyError && historySessions.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No recorded activity yet.</p>
          )}

          {!historyLoading && !historyError && historySessions.length > 0 && (
            <ul className="space-y-4">
              {historySessions.map((session, i) => (
                <li key={i} className="border-l-2 border-blue-400 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {formatSessionRange(session.session_start, session.session_end)}
                    </div>
                    {session.auth_session_id && (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          session.session_active
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {session.session_active ? "Active" : "Signed out"}
                      </span>
                    )}
                  </div>
                  {session.auth_session_created_at && (
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Logged in {formatSessionRange(session.auth_session_created_at, session.auth_session_created_at)}
                    </div>
                  )}
                  {session.pages && session.pages.length > 0 ? (
                    <ol className="mt-1 text-xs text-slate-500 dark:text-slate-400 list-decimal list-inside space-y-0.5">
                      {session.pages.map((path, j) => (
                        <li key={j} className="font-mono">{path}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">No pages recorded</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )}
    </>
  );
}
