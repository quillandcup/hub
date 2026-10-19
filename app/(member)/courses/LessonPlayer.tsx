"use client";

import { useEffect, useRef } from "react";
import { selectPlaybackRate, selectSource, useCaptionsOptions, usePlayer } from "@videojs/react";
import { VideoPlayer, VideoSkin } from "@videojs/react/video";
import { MuxVideo } from "@videojs/react/media/mux-video";
import "@videojs/react/video/skin.css";

export interface PlaybackTokens {
  playback: string;
  poster: string;
  storyboard: string;
}

const RATE_KEY = "course-player:playback-rate";
const CAPTIONS_KEY = "course-player:captions";

// Restores the saved speed once, then saves every later change. (Stored per browser for now; per member comes with watch tracking.)
function RememberSpeed() {
  const rate = usePlayer(selectPlaybackRate);
  const canPlay = usePlayer(selectSource)?.canPlay;
  const restored = useRef(false);
  const restoring = useRef<number | null>(null);
  const setRate = rate?.setPlaybackRate;
  const current = rate?.playbackRate;

  useEffect(() => {
    // The store has no media element to act on until the source can play (setPlaybackRate throws NO_TARGET).
    if (current === undefined || !canPlay) return;
    if (!restored.current) {
      restored.current = true;
      const saved = Number(localStorage.getItem(RATE_KEY));
      if (saved > 0 && saved !== current) {
        restoring.current = saved;
        setRate?.(saved);
      }
      return;
    }
    if (restoring.current !== null && current !== restoring.current) return;
    restoring.current = null;
    localStorage.setItem(RATE_KEY, String(current));
  }, [current, setRate, canPlay]);

  return null;
}

// Remembers the captions choice by the option's label ("Off", "English", ...), since track ids change per video.
function RememberCaptions() {
  const canPlay = usePlayer(selectSource)?.canPlay;
  const captions = useCaptionsOptions();
  const restored = useRef(false);
  const restoring = useRef<string | null>(null);
  const available = captions?.state.availability === "available";
  const selectedLabel = captions?.options.find((o) => o.value === captions.value)?.label;
  const setValue = captions?.setValue;
  const options = captions?.options;

  useEffect(() => {
    if (!canPlay || !available || !options || !setValue || selectedLabel === undefined) return;
    if (!restored.current) {
      restored.current = true;
      const match = options.find((o) => o.label === localStorage.getItem(CAPTIONS_KEY));
      if (match && match.label !== selectedLabel) {
        restoring.current = match.label;
        setValue(match.value);
      }
      return;
    }
    if (restoring.current !== null && selectedLabel !== restoring.current) return;
    restoring.current = null;
    localStorage.setItem(CAPTIONS_KEY, selectedLabel);
  }, [canPlay, available, options, setValue, selectedLabel]);

  return null;
}

// The skin's public theming properties; plum is the Hub's plum-600 from tailwind.config.ts.
const SKIN_THEME = {
  aspectRatio: "16 / 9",
  "--media-accent-color": "#a64d79",
  "--media-accent-text-color": "#ffffff",
  "--media-border-radius": "1rem",
} as React.CSSProperties;

/** The themed lesson player: signed Mux playback, speed and captions remembered. */
export default function LessonPlayer({ title, playbackId, tokens }: { title: string; playbackId: string; tokens: PlaybackTokens }) {
  return (
    <VideoPlayer title={title}>
      <VideoSkin style={SKIN_THEME}>
        <RememberSpeed />
        <RememberCaptions />
        <MuxVideo
          source={{
            playbackId,
            playback: { token: tokens.playback },
            poster: { time: 2, token: tokens.poster },
            storyboard: { format: "webp", token: tokens.storyboard },
          }}
          playsInline
          crossOrigin="anonymous"
        />
      </VideoSkin>
    </VideoPlayer>
  );
}
