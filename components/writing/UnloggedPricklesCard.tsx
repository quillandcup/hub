"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PrickleCheckModal from "@/components/writing/PrickleCheckModal";
import { dismissUnloggedPrickle } from "@/app/(member)/projects/actions";
import type { PrickleOption } from "@/lib/prickle-writing";

interface UnloggedPricklesCardProps {
  /** Recent attended writing prickles with nothing logged and no check-out yet. */
  prickles: PrickleOption[];
}

/**
 * Dashboard prompt to check out of prickles attended recently: how it went, how they feel and how
 * much they wrote, in the same modal as Attendance History's "Check out →". A prickle drops off
 * once it's checked out or has progress logged against it.
 */
export default function UnloggedPricklesCard({ prickles }: UnloggedPricklesCardProps) {
  const router = useRouter();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  // Hidden as soon as the member dismisses them; restored if the save fails.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function handleDismiss(prickleId: string) {
    setError(null);
    setDismissedIds((ids) => new Set(ids).add(prickleId));
    const result = await dismissUnloggedPrickle(prickleId);
    if ("error" in result) {
      setDismissedIds((ids) => {
        const next = new Set(ids);
        next.delete(prickleId);
        return next;
      });
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const visible = prickles.filter((p) => !dismissedIds.has(p.id));
  if (visible.length === 0 && !error) return null;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
        How did it go?
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Check out of recent prickles and log what you wrote, so you can see which sessions work best for you.
      </p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {visible.map((p) => (
          <li key={p.id} className="py-2 flex items-center justify-between gap-3">
            <Link
              href={`/prickles/${p.id}`}
              className="text-sm text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400 truncate"
            >
              {p.label}
            </Link>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setCheckingOut(p.id)}
                className="px-3 py-1 rounded-full text-xs font-medium border border-plum-300 dark:border-plum-700 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-plum-950 transition-colors whitespace-nowrap"
              >
                Check out →
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(p.id)}
                aria-label={`Dismiss ${p.label}`}
                title="Not checking out of this one"
                className="px-2 py-1 text-sm text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {checkingOut && (
        <PrickleCheckModal
          key={checkingOut}
          prickleId={checkingOut}
          half="checkout"
          onClose={() => setCheckingOut(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
