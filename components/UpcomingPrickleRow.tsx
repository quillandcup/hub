import Link from "next/link"
import { clock } from "@/lib/clock";
import { WithSecondaryTime } from "@/components/SecondaryTimezone"
import { hostShortName } from "@/lib/formatters"
import ReasonBadges from "@/components/ReasonBadges"
import { CHECKIN_SOON_MS, checkinOffered, type HighlightReason, type UpcomingPrickle } from "@/lib/upcoming-prickles"
import { checkinAnswered, checkinHref, type CheckinInput } from "@/lib/prickle-checkins"
import type { PrickleCalendarState } from "@/lib/calendar-feed"
import { AddPrickleToCalendar, type AutoIncludedReason } from "@/app/(member)/my-prickles/AddToCalendar"

/** What the row's "Add to my calendar" control needs (see AddPrickleToCalendar). */
export interface UpcomingCalendar {
  state: PrickleCalendarState
  /** When "just this one" is, e.g. "Tue, Oct 6". */
  nextLabel: string
  /** Set when the prickle is already in their calendar without adding it (hosting, a commitment). */
  autoIncluded: AutoIncludedReason | null
}

export { CHECKIN_SOON_MS }

function formatUpcomingTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * One upcoming prickle. When it starts within CHECKIN_SOON_MS and the member has a personal tie to it (checkinOffered), a "Check in →" pill opens the
 * check-in modal (My Prickles' Attendance History, checkinHref). There's no check-out here: this
 * list only holds prickles that haven't started, and the check-out is offered from the history
 * once they have.
 */
export default function UpcomingPrickleRow({
  prickle,
  reasons,
  timeZone,
  checkin = null,
  checkinDismissed = false,
  calendar = null,
  tourTarget = false,
  now = clock.now(),
}: {
  prickle: UpcomingPrickle
  reasons: HighlightReason[]
  timeZone: string
  /** The viewer's saved check-in for this prickle, if any (a finished one reads "Checked in ✓"). */
  checkin?: CheckinInput | null
  /** The member dismissed this prickle's check-in offer (prickle_checkin_dismissals). */
  checkinDismissed?: boolean
  /** Shows "Add to my calendar" beside the time, so there's no need to open the prickle first. */
  calendar?: UpcomingCalendar | null
  /** Marks the calendar control for the Getting started tour's spotlight (the list's first row). */
  tourTarget?: boolean
  now?: number
}) {
  const startsSoon = !checkinDismissed && checkinOffered(prickle, reasons, now)
  const checkedIn = checkinAnswered(checkin)
  return (
    <div className="py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/prickles/${prickle.id}`} data-track="upcoming-prickle-open" className="min-w-0 flex-1 block">
          <p className="text-sm font-medium truncate">{prickle.typeName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {prickle.hostName ? `Hosted by ${hostShortName(prickle.hostName)}` : "No host listed"}
          </p>
        </Link>
        <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-3">
          <p className="text-xs text-slate-600 dark:text-slate-400 text-right">
            <WithSecondaryTime text={formatUpcomingTime(prickle.startTime, timeZone)} instant={prickle.startTime} timeZone={timeZone} />
          </p>
          {calendar && (
            <div data-tour={tourTarget ? "add-to-calendar" : undefined}>
              <AddPrickleToCalendar
                variant="icon"
                prickleId={prickle.id}
                typeName={prickle.typeName}
                nextLabel={calendar.nextLabel}
                state={calendar.state}
                autoIncluded={calendar.autoIncluded}
              />
            </div>
          )}
          {startsSoon && (
            <Link
              href={checkinHref(prickle.id, "checkin")}
              data-track="upcoming-prickle-check-in"
              className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                checkedIn
                  ? "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                  : "border-plum-300 dark:border-plum-700 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-plum-950"
              }`}
            >
              {checkedIn ? "Checked in ✓" : "Check in →"}
            </Link>
          )}
        </div>
      </div>
      <Link data-track="upcoming-prickle-open-card" href={`/prickles/${prickle.id}`} className="block">
        <ReasonBadges reasons={reasons} />
      </Link>
    </div>
  )
}
