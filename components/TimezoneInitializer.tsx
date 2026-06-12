"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { updateTimezonePreference } from "@/app/(member)/profile/actions"

function formatTzDisplay(tz: string): string {
  const now = new Date()
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(now).find(p => p.type === "timeZoneName")?.value ?? ""
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" })
    .formatToParts(now).find(p => p.type === "timeZoneName")?.value
  const city = tz.includes("/") ? tz.split("/").pop()!.replace(/_/g, " ") : tz
  return name ? `(${offset}) ${name} - ${city}` : `(${offset}) ${city}`
}

export function TimezoneInitializer({ storedTimezone }: { storedTimezone: string }) {
  const router = useRouter()
  const [showBanner, setShowBanner] = useState(false)
  const [detectedTz, setDetectedTz] = useState<string>("")

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    setDetectedTz(detected)

    if (storedTimezone === "browser") {
      updateTimezonePreference(detected)
      return
    }

    if (detected !== storedTimezone) {
      const dismissed = localStorage.getItem("tz_mismatch_dismissed")
      if (!dismissed) setShowBanner(true)
    }
  }, [storedTimezone])

  const handleYes = async () => {
    setShowBanner(false)
    await updateTimezonePreference(detectedTz)
    router.refresh()
  }

  const handleNo = () => setShowBanner(false)

  const handleNeverAskAgain = () => {
    setShowBanner(false)
    localStorage.setItem("tz_mismatch_dismissed", "true")
  }

  if (!showBanner || !detectedTz) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 w-80">
      <p className="text-base font-medium text-slate-900 dark:text-slate-100 mb-5 leading-snug">
        Change time zone to {formatTzDisplay(detectedTz)}?
      </p>
      <div className="flex items-center gap-5 justify-end">
        <button
          onClick={handleYes}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 border border-blue-500 dark:border-blue-400 rounded-full px-4 py-1 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
        >
          Yes
        </button>
        <button
          onClick={handleNo}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          No
        </button>
        <button
          onClick={handleNeverAskAgain}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Never ask again
        </button>
      </div>
    </div>
  )
}
