"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface BulkMergeMemberModalProps {
  members: Member[];
  isOpen: boolean;
  onClose: () => void;
}

export default function BulkMergeMemberModal({ members, isOpen, onClose }: BulkMergeMemberModalProps) {
  const router = useRouter();
  const [primaryId, setPrimaryId] = useState<string>(members[0]?.id ?? "");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ field: string; kept: string; discarded: string }[]>([]);

  const primary = members.find((m) => m.id === primaryId);
  const secondaries = members.filter((m) => m.id !== primaryId);

  async function handleMerge() {
    if (!primary || secondaries.length === 0) return;
    setMerging(true);
    setError(null);
    try {
      const allConflicts: { field: string; kept: string; discarded: string }[] = [];
      for (const secondary of secondaries) {
        const res = await fetch("/api/admin/members/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryId: primary.id, secondaryId: secondary.id }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Failed to merge ${secondary.name}`);
        if (json.conflicts?.length) allConflicts.push(...json.conflicts);
      }
      if (allConflicts.length > 0) {
        setConflicts(allConflicts);
        router.refresh();
        return;
      }
      onClose();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Merge Members" maxWidth="lg">
      <div className="space-y-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Select which member to keep as the primary. All others will be merged into it and permanently deleted.
        </p>

        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
            Select primary (keep)
          </p>
          <div className="space-y-2">
            {members.map((m) => (
              <label
                key={m.id}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  primaryId === m.id
                    ? "border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="primary"
                  value={m.id}
                  checked={primaryId === m.id}
                  onChange={() => setPrimaryId(m.id)}
                  className="accent-blue-600"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{m.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{m.email}</p>
                </div>
                {primaryId === m.id && (
                  <span className="ml-auto text-xs font-medium text-blue-600 dark:text-blue-400 flex-shrink-0">Keep</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {primary && secondaries.length > 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-semibold">What will happen:</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-400">
              <li>All attendance records transferred to <strong>{primary.name}</strong></li>
              <li>All activities, hiatuses, and aliases transferred</li>
              <li>Duplicate emails added as aliases so future imports still resolve</li>
              {secondaries.map((s) => (
                <li key={s.id} className="font-semibold">
                  {s.name} ({s.email}) permanently deleted
                </li>
              ))}
            </ul>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-700 p-3 text-xs space-y-1">
            <p className="font-semibold text-orange-800 dark:text-orange-300">Merge complete — ID conflicts detected:</p>
            <ul className="list-disc list-inside space-y-0.5 text-orange-700 dark:text-orange-400">
              {conflicts.map((c) => (
                <li key={c.field}>
                  <strong>{c.field}</strong>: kept <code>{c.kept}</code>, discarded <code>{c.discarded}</code>
                </li>
              ))}
            </ul>
            <p className="text-orange-600 dark:text-orange-500 mt-1">
              Both members had different external IDs. The primary&apos;s values were kept. Verify in Kajabi/Stripe if needed.
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          {conflicts.length > 0 ? (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!primary || secondaries.length === 0 || merging}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900 text-white rounded-lg transition-colors"
              >
                {merging ? "Merging..." : `Merge & Delete ${secondaries.length} Duplicate${secondaries.length !== 1 ? "s" : ""}`}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
