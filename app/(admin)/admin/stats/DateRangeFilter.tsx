"use client"

import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"
import { MIN_DATE, todayDate, ytdStart, qtdStart, mtdStart } from "@/lib/stats-date-range"

const PRESETS = [
  { label: "Year to Date", start: ytdStart },
  { label: "Quarter to Date", start: qtdStart },
  { label: "Month to Date", start: mtdStart },
]

export default function DateRangeFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [error, setError] = useState<string | null>(null)

  function navigate(newFrom: string, newTo: string) {
    const params = new URLSearchParams({ from: newFrom, to: newTo })
    router.push(`${pathname}?${params}`)
  }

  function handleFrom(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val < MIN_DATE) {
      setError("Data is only available from January 1, 2026 onwards.")
      return
    }
    setError(null)
    navigate(val, to)
  }

  function handleTo(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    navigate(from, e.target.value)
  }

  const today = todayDate()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(({ label, start }) => (
          <button
            key={label}
            onClick={() => { setError(null); navigate(start(), today) }}
            className="px-3 py-1 text-sm rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            {label}
          </button>
        ))}
        <span className="text-slate-300 dark:text-slate-600 select-none">|</span>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">From</label>
          <input
            type="date"
            value={from}
            min={MIN_DATE}
            max={to}
            onChange={handleFrom}
            className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-500">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={handleTo}
            className="border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          />
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
