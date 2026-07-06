"use client";

import { useState, useEffect, useCallback } from "react";
import { FEATURE_PREVIEWS } from "@/lib/features";

type Role = "admin" | "assistant" | "member";

interface AppUser {
  id: string;
  email: string;
  role: Role;
  features: string[];
  createdAt: string;
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

export default function UsersClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("member");
  const [editFeatures, setEditFeatures] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(data.users);
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
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(userId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: editRole, features: Array.from(editFeatures) }),
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

  return (
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
                                onClick={() => saveEdit(user.id)}
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
  );
}
