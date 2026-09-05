"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MemberOverrideForm, { type MemberOverrideFields } from "@/components/MemberOverrideForm";
import MemberSearch from "@/components/MemberSearch";

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

type TypeFilter = "all" | "gift" | "special" | "direct_stripe";

export default function MemberOverridesClient() {
  const [overrides, setOverrides] = useState<MemberOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOverride, setEditingOverride] = useState<MemberOverride | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  // Resolves to a member before the shared form (which just needs a memberId)
  // can render.
  const [resolvedMember, setResolvedMember] = useState<Member | null>(null);
  const [allMembers, setAllMembers] = useState<Member[]>([]);

  useEffect(() => {
    fetchOverrides();
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setAllMembers(body.members || []))
      .catch(() => {});
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

  const filteredOverrides = typeFilter === "all" ? overrides : overrides.filter((o) => o.override_type === typeFilter);

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

      <div className="mb-4 flex gap-2 flex-wrap">
        {(["all", "gift", "special", "direct_stripe"] as const).map((type) => {
          const count = type === "all" ? overrides.length : overrides.filter((o) => o.override_type === type).length;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 text-sm rounded-full border ${
                typeFilter === type
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
              }`}
            >
              {type === "all" ? "All" : type} ({count})
            </button>
          );
        })}
      </div>

      {typeFilter === "direct_stripe" && (
        <p className="mb-4 text-sm text-gray-600 dark:text-slate-400">
          Members paying via an ad-hoc Stripe subscription Kajabi doesn&apos;t know about. Reach out to get them
          resubscribed through Kajabi the right way, then <strong>Delete</strong> the override once they have.
        </p>
      )}

      {showForm && (
        <div className="mb-6 p-6 border border-gray-200 rounded bg-gray-50 dark:bg-slate-900 dark:border-slate-700">
          <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">
            {editingOverride ? "Edit Override" : "Add New Override"}
          </h2>

          {!resolvedMember ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-300">
                  Member
                </label>
                <MemberSearch
                  members={allMembers}
                  selectedMemberId={null}
                  onSelect={(member) => setResolvedMember(member)}
                  placeholder="Search by name or email..."
                />
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
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
            {filteredOverrides.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                  {overrides.length === 0 ? "No overrides found. Add one to get started." : "No overrides of this type."}
                </td>
              </tr>
            ) : (
              filteredOverrides.map((override) => (
                <tr key={override.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/members/${override.member_id}`}
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {override.member.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        override.override_type === "gift"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                          : override.override_type === "direct_stripe"
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
