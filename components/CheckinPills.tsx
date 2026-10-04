"use client";

import { checkinAnswered, checkoutAnswered, type CheckinInput } from "@/lib/prickle-checkins";
import type { CheckinHalf } from "@/app/(member)/prickles/checkin-actions";

const pill = "px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap";
const todo = `${pill} border-plum-300 dark:border-plum-700 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-plum-950`;
const done = `${pill} border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800`;

/**
 * "Check in →" and "Check out →" side by side for one attended prickle (Attendance History's list
 * rows and the month view's day panel). A finished half reads "Checked in ✓" and still opens the
 * modal. Clicks don't reach the row, which links to the prickle.
 */
export default function CheckinPills({
  prickleId,
  checkin,
  onOpen,
}: {
  prickleId: string;
  checkin: CheckinInput | null;
  onOpen: (prickleId: string, half: CheckinHalf) => void;
}) {
  return (
    <div className="flex gap-2">
      {(
        [
          ["checkin", "Check in", "Checked in", checkinAnswered(checkin)],
          ["checkout", "Check out", "Checked out", checkoutAnswered(checkin)],
        ] as const
      ).map(([half, todoLabel, doneLabel, answered]) => (
        <button
          key={half}
          type="button"
          className={answered ? done : todo}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(prickleId, half);
          }}
        >
          {answered ? `${doneLabel} ✓` : `${todoLabel} →`}
        </button>
      ))}
    </div>
  );
}
