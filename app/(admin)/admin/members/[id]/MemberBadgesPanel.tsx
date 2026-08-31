"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EarnedBadge } from "@/lib/badges";
import BadgeChip from "@/components/BadgeChip";

interface AwardableBadgeType {
  id: string;
  name: string;
  icon: string;
}

interface RawAward {
  id: string;
  badgeTypeId: string;
  badgeTypeName: string;
  badgeTypeIcon: string;
  occurredAt: string;
  note: string | null;
}

interface MemberBadgesPanelProps {
  memberId: string;
  earnedBadges: EarnedBadge[];
  awardableBadgeTypes: AwardableBadgeType[];
  awards: RawAward[];
}

export default function MemberBadgesPanel({
  memberId,
  earnedBadges,
  awardableBadgeTypes,
  awards,
}: MemberBadgesPanelProps) {
  const router = useRouter();
  const [badgeTypeId, setBadgeTypeId] = useState(awardableBadgeTypes[0]?.id ?? "");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!badgeTypeId) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/member-badges/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, badgeTypeId, occurredAt, note: note.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to award badge");
      setNote("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/member-badges/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to revoke badge");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-lg font-bold mb-4">Badges</h2>

      {earnedBadges.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-6">
          {earnedBadges.map((badge) => (
            <BadgeChip key={badge.badgeType.id} badge={badge} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">No badges yet.</p>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200 text-sm">
          {error}
        </div>
      )}

      {awardableBadgeTypes.length > 0 && (
        <form onSubmit={handleAward} className="flex flex-wrap items-end gap-3 mb-6" aria-label="Award badge">
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="badge-award-type">
              Award badge
            </label>
            <select
              id="badge-award-type"
              value={badgeTypeId}
              onChange={(e) => setBadgeTypeId(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
            >
              {awardableBadgeTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.icon} {type.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="badge-award-date">
              Date
            </label>
            <input
              id="badge-award-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="badge-award-note">
              Note (optional)
            </label>
            <input
              id="badge-award-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Q1 2025"
              className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? "Awarding..." : "Award"}
          </button>
        </form>
      )}

      {awards.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Award history
          </h3>
          <ul className="space-y-1.5">
            {awards.map((award) => (
              <li key={award.id} className="flex items-center justify-between text-sm gap-3">
                <span className="text-slate-700 dark:text-slate-300 truncate">
                  {award.badgeTypeIcon} {award.badgeTypeName}
                  <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{award.occurredAt}</span>
                  {award.note && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">— {award.note}</span>
                  )}
                </span>
                <button
                  onClick={() => handleRevoke(award.id)}
                  disabled={revokingId === award.id}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 flex-shrink-0"
                >
                  {revokingId === award.id ? "Revoking..." : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
