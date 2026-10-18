"use client"

import { useEffect, useRef, useState } from "react"
import { selectPlaybackRate, selectSource, useCaptionsOptions, useMedia, usePlayer } from "@videojs/react"
import { VideoPlayer, VideoSkin } from "@videojs/react/video"
import { MuxVideo } from "@videojs/react/media/mux-video"
import "@videojs/react/video/skin.css"

// Mux's public demo asset (no signing), so the spike needs no keys.
const TEST_PLAYBACK_ID = "a4nOgmxGWg6gULfcBbAa00gXyfcwPnAFldF8RdsNyk8M"

const RATE_KEY = "player-spike:playback-rate"

// Restores the saved speed once, then saves every later change. The real player stores this per member.
function RememberSpeed() {
  const rate = usePlayer(selectPlaybackRate)
  const canPlay = usePlayer(selectSource)?.canPlay
  const restored = useRef(false)
  const restoring = useRef<number | null>(null)
  const setRate = rate?.setPlaybackRate
  const current = rate?.playbackRate

  useEffect(() => {
    // The store has no media element to act on until the source can play (setPlaybackRate throws NO_TARGET).
    if (current === undefined || !canPlay) return
    if (!restored.current) {
      restored.current = true
      const saved = Number(localStorage.getItem(RATE_KEY))
      if (saved > 0 && saved !== current) {
        restoring.current = saved
        setRate?.(saved)
      }
      return
    }
    if (restoring.current !== null && current !== restoring.current) return
    restoring.current = null
    localStorage.setItem(RATE_KEY, String(current))
  }, [current, setRate, canPlay])

  return null
}

const CAPTIONS_KEY = "player-spike:captions"

// Remembers the captions choice by the option's label ("Off", "English", ...), since track ids change per video.
function RememberCaptions() {
  const canPlay = usePlayer(selectSource)?.canPlay
  const captions = useCaptionsOptions()
  const restored = useRef(false)
  const restoring = useRef<string | null>(null)
  const available = captions?.state.availability === "available"
  const selectedLabel = captions?.options.find((o) => o.value === captions.value)?.label
  const setValue = captions?.setValue
  const options = captions?.options

  useEffect(() => {
    if (!canPlay || !available || !options || !setValue || selectedLabel === undefined) return
    if (!restored.current) {
      restored.current = true
      const saved = localStorage.getItem(CAPTIONS_KEY)
      const match = options.find((o) => o.label === saved)
      if (match && match.label !== selectedLabel) {
        restoring.current = match.label
        setValue(match.value)
      }
      return
    }
    if (restoring.current !== null && selectedLabel !== restoring.current) return
    restoring.current = null
    localStorage.setItem(CAPTIONS_KEY, selectedLabel)
  }, [canPlay, available, options, setValue, selectedLabel])

  return null
}

// The skin's public theming properties (the only ones the docs promise to keep). Plum is the Hub's plum-600 from tailwind.config.ts.
const SKIN_THEME = {
  aspectRatio: "16 / 9",
  "--media-accent-color": "#a64d79",
  "--media-accent-text-color": "#ffffff",
  "--media-border-radius": "1rem",
} as React.CSSProperties

type Segment = { start: number; end: number; rate: number; captions: string | null; visible: boolean; reason: string }

// One row per continuous stretch watched: opens on play, closes on pause, seek, speed change, tab hide, page leave or end.
// Time is read from the media element's currentTime, so a stretch's length is media seconds, not wall-clock.
function WatchTracker({ onSegment }: { onSegment: (s: Segment) => void }) {
  const media = useMedia()
  const captions = useCaptionsOptions()
  // null when captions are off; the label ("English") otherwise, since track ids change per video.
  const captionsLabel = !captions?.state.subtitlesShowing ? null : (captions?.options.find((o) => o.value === captions.value)?.label ?? null)
  const captionsRef = useRef(captionsLabel)
  const onSegmentRef = useRef(onSegment)
  const onCaptionsChange = useRef<(() => void) | null>(null)

  // Keep the refs current for the event handlers below. Declared before the captions effect so it sees the new label.
  useEffect(() => {
    captionsRef.current = captionsLabel
    onSegmentRef.current = onSegment
  })

  useEffect(() => {
    onCaptionsChange.current?.()
  }, [captionsLabel])

  useEffect(() => {
    if (!media) return
    const el = media as unknown as HTMLMediaElement
    let open: { start: number; last: number; rate: number; captions: string | null; visible: boolean } | null = null

    const close = (reason: string) => {
      if (!open) return
      const { start, last, rate, captions, visible } = open
      open = null
      if (last - start > 0.25) onSegmentRef.current({ start, end: last, rate, captions, visible, reason })
    }
    const begin = () => {
      if (!open) open = { start: el.currentTime, last: el.currentTime, rate: el.playbackRate, captions: captionsRef.current, visible: !document.hidden }
    }
    const onTime = () => {
      if (open && !el.seeking) open.last = el.currentTime
    }
    const onPlaying = () => begin()
    const onPause = () => { onTime(); close("pause") }
    const onSeeking = () => close("seek")
    const onSeeked = () => { if (!el.paused) begin() }
    const onRate = () => { onTime(); close("speed"); if (!el.paused) begin() }
    const onEnded = () => { onTime(); close("ended") }
    onCaptionsChange.current = () => { onTime(); close("captions"); if (!el.paused) begin() }
    // Hiding or showing the tab splits the stretch but doesn't end it: audio can keep playing, and no `playing` event fires on return.
    // `visible` tells watching on screen from playing in the background.
    const onVisibility = () => { onTime(); close(document.hidden ? "tab hidden" : "tab shown"); if (!el.paused) begin() }
    const onLeave = () => { onTime(); close("page leave") }

    const events: [string, EventListener][] = [
      ["playing", onPlaying], ["timeupdate", onTime], ["pause", onPause], ["seeking", onSeeking],
      ["seeked", onSeeked], ["ratechange", onRate], ["ended", onEnded],
    ]
    events.forEach(([e, f]) => el.addEventListener(e, f))
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onLeave)
    return () => {
      events.forEach(([e, f]) => el.removeEventListener(e, f))
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onLeave)
      onCaptionsChange.current = null
      onTime()
      close("unmount")
    }
  }, [media])

  return null
}

export type SignedSource = { playbackId: string; tokens: { playback: string; poster: string; storyboard: string } }

export default function PlayerSpike({ signed }: { signed: SignedSource | null }) {
  const [segments, setSegments] = useState<Segment[]>([])
  return (
    <>
    <VideoPlayer title={signed ? "Mux signed test video" : "Mux test video"}>
      <VideoSkin style={SKIN_THEME}>
        <RememberSpeed />
        <RememberCaptions />
        <WatchTracker onSegment={(seg) => setSegments((prev) => [...prev, seg])} />
        <MuxVideo
          source={
            signed
              ? {
                  playbackId: signed.playbackId,
                  playback: { token: signed.tokens.playback },
                  poster: { time: 2, token: signed.tokens.poster },
                  storyboard: { format: "webp", token: signed.tokens.storyboard },
                }
              : { playbackId: TEST_PLAYBACK_ID, poster: { time: 2 }, storyboard: { format: "webp" } }
          }
          playsInline
          crossOrigin="anonymous">
          <track kind="captions" src="/player-spike-captions.vtt" srcLang="en" label="English" />
          <track kind="captions" src="/player-spike-captions-es.vtt" srcLang="es" label="Spanish" />
        </MuxVideo>
      </VideoSkin>
    </VideoPlayer>
    <h2 className="mt-4 text-lg font-semibold">Watch segments</h2>
    <ol className="list-decimal pl-6 text-sm">
      {segments.map((seg, i) => (
        <li key={i}>
          {seg.start.toFixed(1)}s to {seg.end.toFixed(1)}s at {seg.rate}x, captions {seg.captions ?? "off"}, {seg.visible ? "visible" : "hidden"} ({seg.reason})
        </li>
      ))}
    </ol>
    </>
  )
}
