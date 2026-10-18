import type { Metadata } from "next"
import Mux from "@mux/mux-node"
import { requireAdminPage } from "@/lib/admin-auth"
import PlayerSpike from "./PlayerSpike"

export const metadata: Metadata = {
  title: "Player spike",
}

// Mux playback IDs are letters and digits; anything else is rejected before it reaches a token.
const PLAYBACK_ID = /^[A-Za-z0-9]{20,}$/

// Temporary: the Video.js v10 half-day test from docs/COURSES.md. Delete once the lesson player exists.
// Without a query it plays Mux's public demo asset. `?signed=<playbackId>` plays a signed-policy asset instead,
// with playback, poster and storyboard tokens minted here, server-side, after the admin check.
export default async function PlayerSpikePage({ searchParams }: PageProps<"/admin/player-spike">) {
  await requireAdminPage()
  const { signed } = await searchParams
  const signedId = typeof signed === "string" && PLAYBACK_ID.test(signed) ? signed : null

  let signedSource: { playbackId: string; tokens: { playback: string; poster: string; storyboard: string } } | null = null
  if (signedId) {
    const mux = new Mux({
      tokenId: process.env.MUX_TOKEN_ID,
      tokenSecret: process.env.MUX_TOKEN_SECRET,
      jwtSigningKey: process.env.MUX_SIGNING_KEY_ID,
      jwtPrivateKey: process.env.MUX_SIGNING_KEY_PRIVATE,
    })
    const tokens = await mux.jwt.signPlaybackId(signedId, { type: ["video", "thumbnail", "storyboard"], expiration: "1h" })
    const playback = tokens["playback-token"]
    const poster = tokens["thumbnail-token"]
    const storyboard = tokens["storyboard-token"]
    if (!playback || !poster || !storyboard) throw new Error("Mux returned fewer playback tokens than requested")
    signedSource = { playbackId: signedId, tokens: { playback, poster, storyboard } }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Player spike: Video.js v10 + Mux</h1>
      <PlayerSpike signed={signedSource} />
    </div>
  )
}
