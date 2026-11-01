"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { selectPlayback, selectPlaybackRate, selectSource, selectTime, useCaptionsOptions, useMedia, usePlayer } from "@videojs/react";
import { VideoPlayer, VideoSkin } from "@videojs/react/video";
import { MuxVideo } from "@videojs/react/media/mux-video";
import "@videojs/react/video/skin.css";
import { courseImageUrl } from "@/lib/courses/image-urls";
import { MAX_SEGMENTS_PER_BATCH, RESUME_MAX_FRACTION, type WatchSegmentInput } from "@/lib/courses/watch";
import { AUTO_COMPLETE_FRACTION, useLessonCompletion } from "./LessonCompletion";

export interface PlaybackTokens {
  playback: string;
  poster: string;
  storyboard: string;
}

const RATE_KEY = "course-player:playback-rate";
const CAPTIONS_KEY = "course-player:captions";

// Restores the saved speed once, then saves every later change. (Stored per browser for now; per member is still to do.)
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

/**
 * Completes the lesson once the playhead passes ~90% of the video *while it is playing* (jumping a
 * paused playhead to the end doesn't count). Does nothing outside a completion provider, for a
 * lesson that's already complete, or when the member has chosen for themselves.
 */
function AutoCompleteAtWatchedMark() {
  const completion = useLessonCompletion();
  const time = usePlayer(selectTime);
  const playback = usePlayer(selectPlayback);
  const autoComplete = completion?.autoComplete;
  const reached = !!time && time.duration > 0 && time.currentTime / time.duration >= AUTO_COMPLETE_FRACTION;
  const playing = !!playback && playback.started && !playback.paused;

  useEffect(() => {
    if (reached && playing) autoComplete?.();
  }, [reached, playing, autoComplete]);

  return null;
}

/** How often a long stretch is checkpointed, so a closed tab or a crash loses at most this much. */
const CHECKPOINT_MS = 30_000;
/** Stretches kept for a resend while saves are failing; the oldest go first so an outage can't grow without bound. */
const MAX_PENDING_SEGMENTS = 200;

/** The media element is an external DOM object, not React state; this keeps writing to it out of render analysis. */
function seekMedia(el: HTMLMediaElement, seconds: number) {
  el.currentTime = seconds;
}

/** Tells the page where the playhead is, to the second (for "Copy timestamp URL" in the course builder). */
function ReportTime({ onTime }: { onTime: (seconds: number) => void }) {
  const time = usePlayer(selectTime);
  const seconds = Math.floor(time?.currentTime ?? 0);
  useEffect(() => onTime(seconds), [seconds, onTime]);
  return null;
}

/** Starts the video where the member left off, once, unless that was (nearly) the end. */
function ResumePosition({ seconds }: { seconds: number }) {
  const media = useMedia();
  const done = useRef(false);

  useEffect(() => {
    if (!media || seconds <= 0) return;
    const el = media as unknown as HTMLMediaElement;
    const apply = () => {
      if (done.current || !(el.duration > 0)) return;
      done.current = true;
      if (seconds / el.duration < RESUME_MAX_FRACTION) seekMedia(el, seconds);
    };
    apply();
    el.addEventListener("loadedmetadata", apply);
    return () => el.removeEventListener("loadedmetadata", apply);
  }, [media, seconds]);

  return null;
}

/**
 * Records what the member watched: one row per continuous stretch (opens on play, closes on pause,
 * seek, speed or captions change, tab hide or show, page leave or the end), with the media seconds
 * from the element's own clock. Rows are batched and sent every 30s while playing and whenever the
 * stretch ends for a reason that may mean leaving; the playhead goes along so the next visit can
 * resume. Sending is best effort (a save that fails for a passing reason is queued and resent; each stretch's id makes a resend safe).
 */
function WatchTracker({ lessonId }: { lessonId: string }) {
  const media = useMedia();
  const captions = useCaptionsOptions();
  // null when captions are off; the label ("English") otherwise, since track ids change per video.
  const captionsLabel = !captions?.state.subtitlesShowing ? null : (captions.options.find((o) => o.value === captions.value)?.label ?? null);
  const captionsRef = useRef(captionsLabel);
  const onCaptionsChange = useRef<(() => void) | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  // The "viewed" marker (the player appeared for this session) rides on requests until one is confirmed.
  const viewedConfirmed = useRef(false);

  // One request to the watch route. Resolves with whether the server answered at all (a refusal is an answer).
  const post = useCallback(
    (segments: WatchSegmentInput[], position: number | null) => {
      const viewed = !viewedConfirmed.current;
      return fetch("/api/courses/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // keepalive lets it finish while the page unloads.
        keepalive: true,
        body: JSON.stringify({ lessonId, sessionId, segments, position, ...(viewed ? { viewed: true } : {}) }),
      }).then((response) => {
        if (viewed && response.ok) viewedConfirmed.current = true;
        return response;
      });
    },
    [lessonId, sessionId],
  );

  // The player appeared: record the view, whether or not anything is played (the play rate's denominator).
  useEffect(() => {
    void post([], null).catch(() => {});
  }, [post]);

  // Declared before the captions effect so the handler sees the new label.
  useEffect(() => {
    captionsRef.current = captionsLabel;
  });
  useEffect(() => {
    onCaptionsChange.current?.();
  }, [captionsLabel]);

  useEffect(() => {
    if (!media) return;
    const el = media as unknown as HTMLMediaElement;
    let open: { start: number; last: number; rate: number; captions: string | null; visible: boolean } | null = null;
    let pending: WatchSegmentInput[] = [];
    let sentPosition = -1;

    const flush = () => {
      const position = el.currentTime;
      if (pending.length === 0 && Math.abs(position - sentPosition) < 1) return;
      // The server takes a limited batch; anything over goes in the next request.
      const segments = pending.slice(0, MAX_SEGMENTS_PER_BATCH);
      pending = pending.slice(MAX_SEGMENTS_PER_BATCH);
      const previousPosition = sentPosition;
      sentPosition = position;
      // A save that fails for a reason that may pass (offline, a server error) goes back in the queue and is
      // resent with the next one; the segment ids make a resend of one that did arrive harmless. A refusal
      // (signed out, no access, bad data) won't pass, so it is dropped. Whatever is queued is lost if the page is.
      const requeue = () => {
        pending = [...segments, ...pending].slice(-MAX_PENDING_SEGMENTS);
        sentPosition = previousPosition;
      };
      void post(segments, position)
        .then((response) => {
          if (response.status >= 500) requeue();
          else if (pending.length > 0) flush();
        })
        .catch(requeue);
    };
    const close = () => {
      if (!open) return;
      const { start, last, rate, captions, visible } = open;
      open = null;
      if (last - start > 0.25) {
        pending.push({ id: crypto.randomUUID(), start, end: last, rate, captions, visible });
        if (pending.length > MAX_PENDING_SEGMENTS) pending = pending.slice(-MAX_PENDING_SEGMENTS);
      }
    };
    const begin = () => {
      if (!open) open = { start: el.currentTime, last: el.currentTime, rate: el.playbackRate, captions: captionsRef.current, visible: !document.hidden };
    };
    const onTime = () => {
      if (open && !el.seeking) open.last = el.currentTime;
    };
    // Close the stretch, send, and carry on if still playing (a speed change, a checkpoint).
    const split = (send: boolean) => {
      onTime();
      close();
      if (send) flush();
      if (!el.paused) begin();
    };
    const stop = () => {
      onTime();
      close();
      flush();
    };

    const onPause = () => stop();
    const onEnded = () => stop();
    const onSeeking = () => close();
    const onSeeked = () => {
      if (!el.paused) begin();
    };
    const onRate = () => split(false);
    // Hiding the tab splits the stretch but doesn't end it: audio can keep playing, and no `playing`
    // event fires on return. `visible` tells watching on screen from playing in the background.
    const onVisibility = () => split(document.hidden);
    const onLeave = () => stop();
    // Restored from the back/forward cache after pagehide closed the stretch: if it is still playing, reopen it.
    const onShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted && !el.paused) begin();
    };
    onCaptionsChange.current = () => split(false);

    const events: [string, EventListener][] = [
      ["playing", begin], ["timeupdate", onTime], ["pause", onPause], ["seeking", onSeeking],
      ["seeked", onSeeked], ["ratechange", onRate], ["ended", onEnded],
    ];
    events.forEach(([e, f]) => el.addEventListener(e, f));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("pageshow", onShow);
    const checkpoint = window.setInterval(() => {
      if (!el.paused) split(true);
    }, CHECKPOINT_MS);
    // The element may already be playing when this attaches.
    if (!el.paused) begin();

    return () => {
      events.forEach(([e, f]) => el.removeEventListener(e, f));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("pageshow", onShow);
      window.clearInterval(checkpoint);
      onCaptionsChange.current = null;
      stop();
    };
  }, [media, post]);

  return null;
}

/**
 * The big plum play button over the poster, until the first play (the v10 skin has only the control
 * bar). It stops above the control bar so that stays usable, and is a real button, so it works from
 * the keyboard and screen readers.
 */
function BigPlayButton() {
  const playback = usePlayer(selectPlayback);
  if (!playback || playback.started) return null;
  return (
    <button
      type="button"
      aria-label="Play video"
      data-track="lesson-play-video"
      onClick={() => void playback.play()}
      className="group absolute inset-x-0 top-0 bottom-14 z-30 flex items-center justify-center focus:outline-none"
    >
      <span className="flex h-20 w-28 items-center justify-center rounded-2xl sm:h-24 sm:w-36 lg:h-28 lg:w-40 bg-plum-600 text-white shadow-xl ring-1 ring-white/30 transition group-hover:scale-105 group-hover:bg-plum-500 group-focus-visible:ring-2 group-focus-visible:ring-white">
        <svg viewBox="0 0 24 24" className="h-11 w-11 sm:h-14 sm:w-14 lg:h-16 lg:w-16" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </button>
  );
}

// The skin's public theming properties; plum is the Hub's plum-600 from tailwind.config.ts.
const SKIN_THEME = {
  aspectRatio: "16 / 9",
  "--media-accent-color": "#a64d79",
  "--media-accent-text-color": "#ffffff",
  "--media-border-radius": "1rem",
} as React.CSSProperties;

/**
 * The themed lesson player: signed Mux playback, speed and captions remembered, resuming where the member left off, and recording what they watched. The poster is the
 * lesson's own thumbnail from Kajabi (what the course author chose), falling back to a frame of the
 * video when there isn't one. The skin's title overlay is hidden, since the page already shows the
 * lesson's title; the title stays as the player's accessible name.
 */
export default function LessonPlayer({
  title,
  playbackId,
  tokens,
  posterUrl,
  lessonId,
  resumeSeconds = 0,
  trackProgress = false,
  onTime,
}: {
  title: string;
  playbackId: string;
  tokens: PlaybackTokens;
  /** The lesson's thumbnail; only http(s) is used. */
  posterUrl?: string | null;
  lessonId?: string;
  /** Where to start, from the member's saved position. */
  resumeSeconds?: number;
  /** Save watch segments and the playhead. Off in sudo and in a staff preview, which leave no viewing history. */
  trackProgress?: boolean;
  /** Called with the playhead's whole second whenever it changes. */
  onTime?: (seconds: number) => void;
}) {
  const poster = courseImageUrl(posterUrl);
  return (
    <div role="group" aria-label={title} className="[&_.media-title]:hidden">
      <VideoPlayer title={title} poster={poster ?? undefined}>
        <VideoSkin style={SKIN_THEME}>
          <RememberSpeed />
          <RememberCaptions />
          <AutoCompleteAtWatchedMark />
          <ResumePosition seconds={resumeSeconds} />
          {onTime && <ReportTime onTime={onTime} />}
          {trackProgress && lessonId && <WatchTracker lessonId={lessonId} />}
          <BigPlayButton />
          <MuxVideo
            source={{
              playbackId,
              playback: { token: tokens.playback },
              // Mux's own frame only when there's no lesson thumbnail to use.
              ...(poster ? {} : { poster: { time: 2, token: tokens.poster } }),
              storyboard: { format: "webp", token: tokens.storyboard },
            }}
            playsInline
            crossOrigin="anonymous"
          />
        </VideoSkin>
      </VideoPlayer>
    </div>
  );
}
