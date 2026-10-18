import type { Metadata } from "next"
import { requireAdminPage } from "@/lib/admin-auth"
import PlayerSpike from "./PlayerSpike"

export const metadata: Metadata = {
  title: "Player spike",
}

// Temporary: the Video.js v10 half-day test from docs/COURSES.md. Delete once the lesson player exists.
export default async function PlayerSpikePage() {
  await requireAdminPage()
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Player spike: Video.js v10 + Mux</h1>
      <PlayerSpike />
    </div>
  )
}
