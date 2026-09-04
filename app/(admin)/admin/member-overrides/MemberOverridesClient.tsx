"use client";

import { useEffect, useState } from "react";
import MemberOverrideForm, { type MemberOverrideFields } from "@/components/MemberOverrideForm";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MemberOverride extends MemberOverrideFields {
  member_id: string;
  starts_at: string;
  created_at: string;
  member: Member;
}

export default function MemberOverridesClient() {
  const [overrides, setOverrides] = useState<MemberOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOverride, setEditingOverride] = useState<MemberOverride | null>(null);

  // Email lookup — resolves to a member before the shared form (which just
  // needs a memberId) can render.
  const [memberEmailInput, setMemberEmailInput] = useState("");
  const [resolvedMember, setResolvedMember] = useState<Member | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverrides();
  }, []);

  const fetchOverrides = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/member-overrides");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch overrides");
      }

      setOverrides(data.overrides);
    } catch (err: any) {
      console.error("Error fetching overrides:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    try {
      const response = await fetch(`/api/members?email=${encodeURIComponent(memberEmailInput)}`);
      const data = await response.json();
      if (!response.ok || !data.members || data.members.length === 0) {
        throw new Error("Member not found with that email address");
      }
      setResolvedMember(data.members[0]);
    } catch (err: any) {
      setLookupError(err.message);
    }
  };

  const handleEdit = (override: MemberOverride) => {
    setEditingOverride(override);
    setResolvedMember(override.member);
    setShowForm(true);
  };

  const handleSaved = () => {
    handleCancel();
    fetchOverrides();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this override?")) {
      return;
    }

    try {
      const response = await fetch(`/api/member-overrides/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete override");
      }

      fetchOverrides();
    } catch (err: any) {
      console.error("Error deleting override:", err);
      setError(err.message);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingOverride(null);
    setResolvedMember(null);
    setMemberEmailInput("");
    setLookupError(null);
    setError(null);
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4 text-slate-900 dark:text-slate-100">Member Status Overrides</h1>
        <p className="text-slate-600 dark:text-slate-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2 text-slate-900 dark:text-slate-100">Member Status Overrides</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Manage special cases where member status differs from default rules
          (gifts, 180 program, etc.) Hiatus is tracked separately, per-member.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mb-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add Override
        </button>
      )}

      {showForm && (
        <div className="mb-6 p-6 border border-gray-200 rounded bg-gray-50 dark:bg-slate-900 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">
            {editingOverride ? "Edit Override" : "Add New Override"}
          </h2>

          {!resolvedMember ? (
            <form onSubmit={handleLookup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  Member Email
                </label>
                <input
                  type="email"
                  value={memberEmailInput}
                  onChange={(e) => setMemberEmailInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  required
                  autoFocus
                />
                {lookupError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{lookupError}</p>}
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                  Find Member
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <MemberOverrideForm
              memberId={resolvedMember.id}
              memberName={resolvedMember.name}
              existing={editingOverride}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          )}
        </div>
      )}

      <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">
                Member
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">
                Type
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">
                Reason
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">
                Expires
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-slate-300">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
            {overrides.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                  No overrides found. Add one to get started.
                </td>
              </tr>
            ) : (
              overrides.map((override) => (
                <tr key={override.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{override.member.name}</div>
                    <div className="text-sm text-gray-600 dark:text-slate-400">
                      {override.member.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        override.override_type === "gift"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                          : override.override_type === "180_program"
                          ? "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300"
                          : "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                      }`}
                    >
                      {override.override_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-900 dark:text-slate-100">{override.reason}</div>
                    {override.notes && (
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                        {override.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
                    {override.expires_at
                      ? new Date(override.expires_at).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(override)}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(override.id)}
                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
