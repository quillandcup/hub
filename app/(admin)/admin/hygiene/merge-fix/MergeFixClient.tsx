"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BulkMergeMemberModal from "../../members/BulkMergeMemberModal";
import type { EnrichedGroup } from "@/lib/merge-fix";
import { dismissGroup, undismissGroup } from "./actions";

export type { EnrichedGroup };

interface MergeFixClientProps {
  duplicateGroups: EnrichedGroup[];
  dismissedKeys: Set<string>;
}

const AVATAR_COLORS = [
  "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
];

function groupKey(group: EnrichedGroup) {
  return group.members.map((m) => m.id).sort().join("|");
}

export default function MergeFixClient({ duplicateGroups, dismissedKeys }: MergeFixClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticDismissed, setOptimisticDismissed] = useState<Set<string>>(dismissedKeys);
  const [showDismissed, setShowDismissed] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<EnrichedGroup | null>(null);
  const [mergingAll, setMergingAll] = useState(false);
  const [mergeAllError, setMergeAllError] = useState<string | null>(null);

  const visible = duplicateGroups.filter((g) => !optimisticDismissed.has(groupKey(g)));
  const dismissedGroups = duplicateGroups.filter((g) => optimisticDismissed.has(groupKey(g)));

  function dismiss(group: EnrichedGroup) {
    const key = groupKey(group);
    setOptimisticDismissed((prev) => new Set([...prev, key]));
    startTransition(() => { dismissGroup(key); });
  }

  function undismiss(group: EnrichedGroup) {
    const key = groupKey(group);
    setOptimisticDismissed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    startTransition(() => { undismissGroup(key); });
  }

  async function mergeAll() {
    setMergingAll(true);
    setMergeAllError(null);
    try {
      for (const group of visible) {
        const [primary, ...secondaries] = group.members;
        for (const secondary of secondaries) {
          const res = await fetch("/api/admin/members/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ primaryId: primary.id, secondaryId: secondary.id }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? `Failed to merge ${secondary.name}`);
        }
      }
      router.refresh();
    } catch (err: unknown) {
      setMergeAllError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMergingAll(false);
    }
  }

  if (visible.length === 0 && dismissedGroups.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          No duplicates found
        </h2>
        <p className="text-slate-500 dark:text-slate-400">
          All members have unique names and emails.
        </p>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <>
        <div className="text-center py-16">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            All caught up
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            You&apos;ve dismissed all suggestions.
          </p>
        </div>
        {renderDismissedSection()}
      </>
    );
  }

  function renderDismissedSection() {
    if (dismissedGroups.length === 0) return null;
    return (
      <div className="mt-8">
        <button
          onClick={() => setShowDismissed((v) => !v)}
          className="text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {showDismissed ? "Hide" : "Show"} {dismissedGroups.length} dismissed suggestion{dismissedGroups.length !== 1 ? "s" : ""}
        </button>

        {showDismissed && (
          <div className="mt-3 space-y-4 opacity-60">
            {dismissedGroups.map((group) => (
              <div
                key={groupKey(group)}
                className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden"
              >
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {group.reason}
                  </span>
                </div>

                <div className="p-4 flex flex-wrap gap-6">
                  {group.members.map((member, j) => (
                    <div key={member.id} className="flex items-start gap-3 min-w-0">
                      {j > 0 && (
                        <span className="self-center text-slate-300 dark:text-slate-600 text-lg select-none">
                          /
                        </span>
                      )}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${AVATAR_COLORS[j % AVATAR_COLORS.length]}`}>
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/members/${member.id}`}
                            className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate"
                          >
                            {member.name}
                          </Link>
                          {j === 0 && (
                            <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">(primary)</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {member.email}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    onClick={() => undismiss(group)}
                    className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {visible.length} potential duplicate group{visible.length !== 1 ? "s" : ""} found
        </p>
        <button
          onClick={mergeAll}
          disabled={mergingAll}
          className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
        >
          {mergingAll ? "Merging all…" : "Merge All"}
        </button>
      </div>

      {mergeAllError && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {mergeAllError}
        </div>
      )}

      <div className="space-y-4">
        {visible.map((group) => (
          <div
            key={groupKey(group)}
            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {group.reason}
              </span>
            </div>

            <div className="p-4 flex flex-wrap gap-6">
              {group.members.map((member, j) => (
                <div key={member.id} className="flex items-start gap-3 min-w-0">
                  {j > 0 && (
                    <span className="self-center text-slate-300 dark:text-slate-600 text-lg select-none">
                      /
                    </span>
                  )}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${AVATAR_COLORS[j % AVATAR_COLORS.length]}`}>
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate"
                      >
                        {member.name}
                      </Link>
                      {j === 0 && (
                        <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">(primary)</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {member.email}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        member.status === "active"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}>
                        {member.status.replace("_", " ")}
                      </span>
                      {member.stripe_customer_id && (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          member.stripe_active
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}>
                          {member.stripe_active ? "active in Stripe" : "in Stripe"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => dismiss(group)}
                className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={() => setMergeTarget(group)}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Merge
              </button>
            </div>
          </div>
        ))}
      </div>

      {renderDismissedSection()}

      {mergeTarget && (
        <BulkMergeMemberModal
          members={mergeTarget.members.map((m) => ({ id: m.id, name: m.name, email: m.email }))}
          isOpen={true}
          onClose={() => setMergeTarget(null)}
        />
      )}
    </>
  );
}
