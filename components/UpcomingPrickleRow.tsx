import Link from "next/link"
import { hostShortName } from "@/lib/formatters"
import ReasonBadges from "@/components/ReasonBadges"
import type { HighlightReason, UpcomingPrickle } from "@/lib/upcoming-prickles"
import { checkinAnswered, checkinHref, type CheckinInput } from "@/lib/prickle-checkins"

/** How far ahead of the start a prickle offers its "Check in →" pill. */
export const CHECKIN_SOON_MS = 2 * 60 * 60 * 1000

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
 * One upcoming prickle. When it starts within CHECKIN_SOON_MS, a "Check in →" pill opens the
 * check-in modal (My Prickles' Attendance History, checkinHref). There's no check-out here: this
 * list only holds prickles that haven't started, and the check-out is offered from the history
 * once they have.
 */
export default function UpcomingPrickleRow({
  prickle,
  reasons,
  timeZone,
  checkin = null,
  now = Date.now(),
}: {
  prickle: UpcomingPrickle
  reasons: HighlightReason[]
  timeZone: string
  /** The viewer's saved check-in for this prickle, if any (a finished one reads "Checked in ✓"). */
  checkin?: CheckinInput | null
  now?: number
}) {
  const startsSoon = new Date(prickle.startTime).getTime() - now <= CHECKIN_SOON_MS
  const checkedIn = checkinAnswered(checkin)
  return (
    <div className="py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/prickles/${prickle.id}`} className="min-w-0 flex-1 block">
          <p className="text-sm font-medium truncate">{prickle.typeName}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {prickle.hostName ? `Hosted by ${hostShortName(prickle.hostName)}` : "No host listed"}
          </p>
        </Link>
        <div className="flex-shrink-0 flex items-center gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 text-right">
            {formatUpcomingTime(prickle.startTime, timeZone)}
          </p>
          {startsSoon && (
            <Link
              href={checkinHref(prickle.id, "checkin")}
              className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors ${
                checkedIn
                  ? "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
                  : "border-plum-300 dark:border-plum-700 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-plum-950"
              }`}
            >
              {checkedIn ? "Checked in ✓" : "Check in →"}
            </Link>
          )}
        </div>
      </div>
      <Link href={`/prickles/${prickle.id}`} className="block">
        <ReasonBadges reasons={reasons} />
      </Link>
    </div>
  )
}
