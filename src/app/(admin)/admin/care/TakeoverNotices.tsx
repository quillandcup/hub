"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/client";
import { dismissCareTakeoverNotice } from "./actions";
import type { EngagementCardData } from "./card";

const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

/**
 * "Taken over": the care plans an admin took from the signed-in staff member without their agreement (docs/product/HEDGIE_CARE.md,
 * "Owners": the one exception to hand-overs needing both sides), next to "Waiting for you" on the Active and Earlier tabs. It
 * says who took which member's plan and when, and goes away when they dismiss it. Nothing is sent to them: the page is the
 * only way they hear of it for now (`docs/TODO.md`). Renders nothing when there is nothing to tell.
 */
export default function TakeoverNotices({ cards }: { cards: readonly EngagementCardData[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const notices = cards.filter((card) => card.takeoverNotice);
  if (notices.length === 0) return null;

  function dismiss(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await dismissCareTakeoverNotice(id);
      if ("error" in result) return setError(result.error);
      track("care_takeover_notice_dismissed", {});
    });
  }

  return (
    <section aria-labelledby="care-taken-over-heading" className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 id="care-taken-over-heading" className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Taken over
      </h2>
      <ul className="mt-2 space-y-2">
        {notices.map((card) => (
          <li key={card.id} className="flex flex-col gap-2 @pair:flex-row @pair:items-center @pair:justify-between">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {card.takeoverNotice!.byName} took over{" "}
              <Link href={`/admin/members/${card.memberId}`} className="font-medium text-plum-700 hover:underline dark:text-plum-300">
                {card.memberName}
              </Link>
              &apos;s care plan on {card.takeoverNotice!.onLabel}.
            </p>
            <button type="button" data-track="care-takeover-dismiss" className={BUTTON} disabled={pending} onClick={() => dismiss(card.id)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
