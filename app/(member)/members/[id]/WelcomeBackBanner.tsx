"use client"

import { useEffect, useState } from "react"

// Client-side-only dismissal: no backend state for "have they seen this yet."
// Defaults to hidden until we've checked localStorage, to avoid a
// show-then-hide flash for members who already dismissed it.
export default function WelcomeBackBanner({
  memberId,
  rejoinedAt,
  monthLabel,
}: {
  memberId: string
  rejoinedAt: string
  monthLabel: string
}) {
  const key = `welcome-back-seen:${memberId}:${rejoinedAt}`
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(!!window.localStorage.getItem(key))
  }, [key])

  if (dismissed) return null

  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
      <span>🎉 Welcome back! You rejoined in {monthLabel}.</span>
      <button
        onClick={() => {
          window.localStorage.setItem(key, "1")
          setDismissed(true)
        }}
        className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
