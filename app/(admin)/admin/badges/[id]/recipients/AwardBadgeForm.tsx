"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MemberSearch from "@/components/MemberSearch";

interface Member {
  id: string;
  name: string;
  email: string;
}

export default function AwardBadgeForm({ badgeTypeId }: { badgeTypeId: string }) {
  const router = useRouter();
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setAllMembers(body.members || []))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/member-badges/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id, badgeTypeId, occurredAt, note: note.trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to award badge");
      setMember(null);
      setNote("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
      {error && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3" aria-label="Award badge">
        <div className="flex-1 min-w-[14rem]">
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Member</label>
          <MemberSearch
            members={allMembers}
            selectedMemberId={member?.id ?? null}
            onSelect={setMember}
            placeholder="Search by name or email..."
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="award-date">
            Date
          </label>
          <input
            id="award-date"
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1" htmlFor="award-note">
            Note (optional)
          </label>
          <input
            id="award-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !member}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {submitting ? "Awarding..." : "Award"}
        </button>
      </form>
    </div>
  );
}
