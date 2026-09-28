import Link from "next/link"
import type { PublicHostingSummary } from "@/lib/hosting-stats"
import type { HostedScheduleSlot } from "@/lib/prickle-schedule"

function formatMonthYear(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone })
}

function formatShortDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })
}

/**
 * Public "Hosting" card on a member profile: hosting totals and the host's upcoming recurring
 * slots, so other members can find and join their prickles. Renders nothing for a member who
 * has neither hosted nor has anything upcoming. Punctuality stats are intentionally absent --
 * see PublicHostingSummary.
 */
export default function MemberHostingCard({
  summary,
  slots,
  timeZone,
  firstName,
}: {
  summary: PublicHostingSummary
  slots: HostedScheduleSlot[]
  timeZone: string
  firstName: string
}) {
  if (summary.totalHosted === 0 && slots.length === 0) return null

  const avg = summary.avgAttendance === null ? null : Math.round(summary.avgAttendance)

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        Hosting
      </h2>

      {summary.totalHosted > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{summary.totalHosted}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {summary.totalHosted === 1 ? "prickle hosted" : "prickles hosted"}
              </p>
            </div>
            {summary.firstHostedAt && (
              <div className="text-center">
                <p className="text-2xl font-bold">{formatMonthYear(summary.firstHostedAt, timeZone)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">hosting since</p>
              </div>
            )}
            {avg !== null && (
              <div className="text-center">
                <p className="text-2xl font-bold">~{avg}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {avg === 1 ? "Hedgie" : "Hedgies"} per session
                </p>
              </div>
            )}
          </div>
          {summary.typeNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">
              {summary.typeNames.map((name) => (
                <span
                  key={name}
                  className="text-xs bg-slate-100 dark:bg-slate-800 rounded px-2 py-0.5 text-slate-600 dark:text-slate-300"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {slots.length > 0 && (
        <div className={summary.totalHosted > 0 ? "mt-4 pt-4 border-t border-slate-100 dark:border-slate-800" : ""}>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Join {firstName} at</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {slots.map((slot) => (
              <li key={slot.seriesKey}>
                <Link
                  href={`/prickles/${slot.nextOccurrenceId}`}
                  className="group flex items-baseline justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-plum-600 dark:group-hover:text-plum-400">
                      {slot.upcomingCount > 1 ? `${slot.dayOfWeek}s` : slot.dayOfWeek} · {slot.timeLabel}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400"> — {slot.typeName}</span>
                  </span>
                  <span className="flex-shrink-0 text-xs text-slate-400 dark:text-slate-500">
                    next {formatShortDate(slot.nextOccurrenceStart, timeZone)} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
