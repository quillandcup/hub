"use client";

import { useState } from "react";

export interface MemberOverrideFields {
  id: string;
  override_type: "gift" | "special" | "180_program";
  reason: string;
  notes: string | null;
  expires_at: string | null;
}

interface MemberOverrideFormProps {
  memberId: string;
  memberName?: string;
  existing?: MemberOverrideFields | null;
  onSaved: () => void;
  onCancel: () => void;
}

// Shared create/edit form for member_status_overrides (gift/special/180_program).
// Hiatus has its own dedicated table and UI (MemberHiatusPanel, on the
// member detail page) — it's common enough to deserve first-class tracking
// rather than living in this generic exceptions bucket.
// Used both by /admin/member-overrides (after its own email lookup resolves
// a memberId) and /admin/reconciliation (which already knows the member).
// POSTs/PATCHes the same /api/member-overrides endpoints either way.
export default function MemberOverrideForm({
  memberId,
  memberName,
  existing,
  onSaved,
  onCancel,
}: MemberOverrideFormProps) {
  const [formData, setFormData] = useState({
    override_type: existing?.override_type ?? ("gift" as "gift" | "special" | "180_program"),
    reason: existing?.reason ?? "",
    notes: existing?.notes ?? "",
    expires_at: existing?.expires_at ? existing.expires_at.split("T")[0] : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const payload = {
        member_id: memberId,
        override_type: formData.override_type,
        reason: formData.reason,
        notes: formData.notes || null,
        expires_at: formData.expires_at || null,
      };

      const response = existing
        ? await fetch(`/api/member-overrides/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/member-overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save override");

      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {memberName && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          For <span className="font-medium text-gray-900 dark:text-gray-100">{memberName}</span>
        </p>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Override Type</label>
        <select
          value={formData.override_type}
          onChange={(e) =>
            setFormData({ ...formData, override_type: e.target.value as "gift" | "special" | "180_program" })
          }
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100 rounded"
          required
        >
          <option value="gift">Gift (hosting, compensation)</option>
          <option value="180_program">180 Program</option>
          <option value="special">Special Case</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Reason</label>
        <input
          type="text"
          value={formData.reason}
          onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100 rounded"
          placeholder="e.g., free month for hosting the fall 2026 virtual retreat"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Notes (optional)</label>
        <textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100 rounded"
          rows={2}
          placeholder="Additional context or details"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-200">Expires At (optional)</label>
        <input
          type="date"
          value={formData.expires_at}
          onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100 rounded"
        />
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Leave blank for no expiration</p>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : existing ? "Update Override" : "Create Override"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-300 dark:bg-slate-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-slate-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
