import Link from "next/link"
import { hostShortName } from "@/lib/formatters"
import ReasonBadges from "@/components/ReasonBadges"
import type { HighlightReason, UpcomingPrickle } from "@/lib/upcoming-prickles"

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

export default function UpcomingPrickleRow({
  prickle,
  reasons,
  timeZone,
}: {
  prickle: UpcomingPrickle
  reasons: HighlightReason[]
  timeZone: string
}) {
  return (
    <Link
      href={`/prickles/${prickle.id}`}
      className="block py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 -mx-2 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{prickle.typeName}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {prickle.hostName ? `Hosted by ${hostShortName(prickle.hostName)}` : "No host listed"}
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 ml-4 text-right">
          {formatUpcomingTime(prickle.startTime, timeZone)}
        </p>
      </div>
      <ReasonBadges reasons={reasons} />
    </Link>
  )
}
