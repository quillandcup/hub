import Link from "next/link";
import { checkinAnswered, checkinHref, checkoutAnswered, type CheckinInput } from "@/lib/prickle-checkins";
import { MEASURE_LABELS } from "@/lib/writing-projects";
import type { PrickleEntryRow } from "@/app/(member)/projects/actions";

interface PrickleCheckLinksProps {
  prickleId: string;
  hasStarted: boolean;
  checkin: CheckinInput | null;
  /** Progress the viewer logged against this prickle, shown as a one-line summary. */
  entries: PrickleEntryRow[];
  /** "Coming in" answers carried from Find a Prickle, passed on to the check-in modal. */
  prefill?: CheckinInput | null;
}

const pill =
  "px-3 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap";
const todo = `${pill} border-plum-300 dark:border-plum-700 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-plum-950`;
const done = `${pill} border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800`;

/**
 * The prickle page's pointer to the viewer's own check-in, check-out and logged progress. They're
 * answered in the modal on My Prickles' Attendance History (checkinHref), not here, so a page
 * about the prickle isn't taken over by forms for people who weren't there.
 */
export default function PrickleCheckLinks({ prickleId, hasStarted, checkin, entries, prefill = null }: PrickleCheckLinksProps) {
  const checkedIn = checkinAnswered(checkin);
  const checkedOut = checkoutAnswered(checkin);
  return (
    <section
      aria-label="Your check-in"
      className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between gap-4 flex-wrap"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Your check-in</p>
        {entries.length > 0 && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Logged{" "}
            {entries
              .map(
                (e) =>
                  `${e.mode === "set_total" ? "=" : e.amount >= 0 ? "+" : ""}${e.amount.toLocaleString()} ${MEASURE_LABELS[e.measure].toLowerCase()} on ${e.projectTitle}`
              )
              .join(", ")}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Link
          href={checkinHref(prickleId, "checkin", prefill?.feelingsBefore ?? [], prefill?.need ?? null)}
          className={checkedIn ? done : todo}
        >
          {checkedIn ? "Checked in ✓" : "Check in →"}
        </Link>
        {hasStarted && (
          <Link href={checkinHref(prickleId, "checkout")} className={checkedOut ? done : todo}>
            {checkedOut ? "Checked out ✓" : "Check out →"}
          </Link>
        )}
      </div>
    </section>
  );
}
