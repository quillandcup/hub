"use client";

import { useEffect, useState } from "react";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MemberOverride {
  id: string;
  member_id: string;
  override_type: "hiatus" | "gift" | "special";
  reason: string;
  notes: string | null;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
  member: Member;
}

export default function MemberOverridesPage() {
  const [overrides, setOverrides] = useState<MemberOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingOverride, setEditingOverride] = useState<MemberOverride | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    member_email: "",
    override_type: "gift" as "hiatus" | "gift" | "special",
    reason: "",
    notes: "",
    expires_at: "",
  });

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      // First, look up member by email
      const membersResponse = await fetch(
        `/api/members?email=${encodeURIComponent(formData.member_email)}`
      );
      const membersData = await membersResponse.json();

      if (!membersResponse.ok || !membersData.members || membersData.members.length === 0) {
        throw new Error("Member not found with that email address");
      }

      const member = membersData.members[0];

      const payload = {
        member_id: member.id,
        override_type: formData.override_type,
        reason: formData.reason,
        notes: formData.notes || null,
        expires_at: formData.expires_at || null,
      };

      let response;
      if (editingOverride) {
        response = await fetch(`/api/member-overrides/${editingOverride.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        response = await fetch("/api/member-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save override");
      }

      // Reset form and refresh list
      setFormData({
        member_email: "",
        override_type: "gift",
        reason: "",
        notes: "",
        expires_at: "",
      });
      setShowForm(false);
      setEditingOverride(null);
      fetchOverrides();
    } catch (err: any) {
      console.error("Error saving override:", err);
      setError(err.message);
    }
  };

  const handleEdit = (override: MemberOverride) => {
    setEditingOverride(override);
    setFormData({
      member_email: override.member.email,
      override_type: override.override_type,
      reason: override.reason,
      notes: override.notes || "",
      expires_at: override.expires_at || "",
    });
    setShowForm(true);
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
    setFormData({
      member_email: "",
      override_type: "gift",
      reason: "",
      notes: "",
      expires_at: "",
    });
    setError(null);
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Member Status Overrides</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Member Status Overrides</h1>
        <p className="text-gray-600">
          Manage special cases where member status differs from default rules
          (hiatus, gifts, 180 program, etc.)
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-red-800">{error}</p>
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
        <div className="mb-6 p-6 border border-gray-200 rounded bg-gray-50">
          <h2 className="text-lg font-semibold mb-4">
            {editingOverride ? "Edit Override" : "Add New Override"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Member Email
              </label>
              <input
                type="email"
                value={formData.member_email}
                onChange={(e) =>
                  setFormData({ ...formData, member_email: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded"
                required
                disabled={!!editingOverride}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Override Type
              </label>
              <select
                value={formData.override_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    override_type: e.target.value as "hiatus" | "gift" | "special",
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded"
                required
              >
                <option value="gift">Gift (180 program, hosting, compensation)</option>
                <option value="hiatus">Hiatus</option>
                <option value="special">Special Case</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Reason</label>
              <input
                type="text"
                value={formData.reason}
                onChange={(e) =>
                  setFormData({ ...formData, reason: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded"
                placeholder="e.g., 180 program, Mika affiliates compensation"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Notes (optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded"
                rows={2}
                placeholder="Additional context or details"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Expires At (optional)
              </label>
              <input
                type="date"
                value={formData.expires_at}
                onChange={(e) =>
                  setFormData({ ...formData, expires_at: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
              <p className="text-sm text-gray-500 mt-1">
                Leave blank for no expiration
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {editingOverride ? "Update" : "Create"} Override
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Member
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Type
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Reason
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Expires
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {overrides.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No overrides found. Add one to get started.
                </td>
              </tr>
            ) : (
              overrides.map((override) => (
                <tr key={override.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{override.member.name}</div>
                    <div className="text-sm text-gray-600">
                      {override.member.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        override.override_type === "gift"
                          ? "bg-green-100 text-green-800"
                          : override.override_type === "hiatus"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {override.override_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">{override.reason}</div>
                    {override.notes && (
                      <div className="text-xs text-gray-500 mt-1">
                        {override.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {override.expires_at
                      ? new Date(override.expires_at).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(override)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(override.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
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
