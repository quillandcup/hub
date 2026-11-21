"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { track } from "@/lib/analytics/client";
import { acceptCareHandover, declineCareHandover, type CareActionResult } from "./actions";
import type { EngagementCardData } from "./card";

const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";
const PRIMARY = "rounded-lg bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";

/**
 * "Waiting for you": the care plans offered to the signed-in staff member, at the top of the Active and Earlier tabs. A care
 * plan changes hands only when the receiver accepts (docs/product/HEDGIE_CARE.md, "Owners"), so this is where they say yes or no; until
 * then the plan stays with its owner. Nothing is sent to them: the page is the only way they hear of it for now (`docs/TODO.md`).
 * Renders nothing when nothing is waiting.
 */
export default function HandoverInbox({ cards }: { cards: readonly EngagementCardData[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const waiting = cards.filter((card) => card.controls.offeredToMe && card.handover);
  if (waiting.length === 0) return null;

  function answer(action: () => Promise<CareActionResult>, event: "care_handover_accepted" | "care_handover_declined") {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) return setError(result.error);
      track(event, {});
    });
  }

  return (
    <section aria-labelledby="care-waiting-heading" className="mb-6 rounded-lg border border-plum-200 bg-plum-50 p-4 dark:border-plum-900 dark:bg-plum-950">
      <h2 id="care-waiting-heading" className="text-base font-semibold text-plum-900 dark:text-plum-100">
        Waiting for you
      </h2>
      <p className="mt-1 text-sm text-plum-900 dark:text-plum-100">
        Someone would like you to take over their care plan with a member. It stays with them until you accept.
      </p>
      <ul className="mt-3 space-y-2">
        {waiting.map((card) => (
          <li key={card.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <Link href={`/admin/members/${card.memberId}`} className="font-semibold text-plum-700 hover:underline dark:text-plum-300">
                {card.memberName}
              </Link>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {card.ownerId ? `From ${card.ownerName}` : "No one holds it now"}
                {card.handover && card.handover.byName !== card.ownerName ? ` · offered by ${card.handover.byName}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-track="care-handover-accept" className={PRIMARY} disabled={pending} onClick={() => answer(() => acceptCareHandover(card.id), "care_handover_accepted")}>
                Accept
              </button>
              <button type="button" data-track="care-handover-decline" className={BUTTON} disabled={pending} onClick={() => answer(() => declineCareHandover(card.id), "care_handover_declined")}>
                Decline
              </button>
            </div>
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
