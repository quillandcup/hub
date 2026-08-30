"use client"

import { useState } from "react"

export type ReasonKind = "hosting" | "streak" | "lostStreak" | "sister"

export interface ReasonBadgeData {
  kind: ReasonKind
  tooltip: string[]
}

const REASON_ICON: Record<ReasonKind, string> = {
  hosting: "🎤",
  streak: "🔥",
  lostStreak: "💔",
  sister: "🤝",
}

const REASON_LABEL: Record<ReasonKind, string> = {
  hosting: "Hosting",
  streak: "Active streak",
  lostStreak: "Lost streak",
  sister: "Likely sister attendance",
}

function ReasonBadge({ reason }: { reason: ReasonBadgeData }) {
  const [show, setShow] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <span
        tabIndex={0}
        role="img"
        aria-label={[REASON_LABEL[reason.kind], ...reason.tooltip].join(" — ")}
        className="flex items-center justify-center w-6 h-6 rounded bg-blue-50 dark:bg-blue-900/20 text-sm cursor-default"
      >
        <span aria-hidden>{REASON_ICON[reason.kind]}</span>
      </span>
      {show && (
        <div
          role="tooltip"
          className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[220px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-lg px-2.5 py-1.5 shadow-lg"
        >
          <p className="font-medium">{REASON_LABEL[reason.kind]}</p>
          {reason.tooltip.map((line, i) => (
            <p key={i} className="text-slate-300 dark:text-slate-600">
              {line}
            </p>
          ))}
        </div>
      )}
    </span>
  )
}

export default function ReasonBadges({ reasons }: { reasons: ReasonBadgeData[] }) {
  if (reasons.length === 0) return null
  return (
    <div className="flex gap-1.5 mt-2">
      {reasons.map((r) => (
        <ReasonBadge key={r.kind} reason={r} />
      ))}
    </div>
  )
}
