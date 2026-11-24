"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import LessonPlayer, { type SeekRequest } from "@/components/courses/LessonPlayer";

interface PlayerTimeValue {
  seconds: number;
  setSeconds: (seconds: number) => void;
  seekRequest: SeekRequest | null;
  seekTo: (seconds: number) => void;
}

const PlayerTimeContext = createContext<PlayerTimeValue>({ seconds: 0, setSeconds: () => {}, seekRequest: null, seekTo: () => {} });

/** Where the lesson's player is, shared with controls elsewhere on the page ("Copy link" at this moment, a comment's timestamp). */
export function PlayerTimeProvider({ children }: { children: ReactNode }) {
  const [seconds, setSeconds] = useState(0);
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const seekTo = useCallback((to: number) => setSeekRequest((previous) => ({ seconds: to, nonce: (previous?.nonce ?? 0) + 1 })), []);
  const value = useMemo(() => ({ seconds, setSeconds, seekRequest, seekTo }), [seconds, seekRequest, seekTo]);
  return <PlayerTimeContext.Provider value={value}>{children}</PlayerTimeContext.Provider>;
}

/** Whole seconds into the video; 0 outside a provider. */
export function usePlayerSeconds(): number {
  return useContext(PlayerTimeContext).seconds;
}

/** Moves the lesson's video to a second and plays it (a comment's timestamp); does nothing outside a provider or without a player. */
export function usePlayerSeek(): (seconds: number) => void {
  return useContext(PlayerTimeContext).seekTo;
}

/** The latest request to move the video, for tests and the player itself. */
export function useSeekRequest(): SeekRequest | null {
  return useContext(PlayerTimeContext).seekRequest;
}

/** The lesson player, reporting its position to the provider above it and moving when asked. */
export function TimedLessonPlayer(props: ComponentProps<typeof LessonPlayer>) {
  const { setSeconds, seekRequest } = useContext(PlayerTimeContext);
  return <LessonPlayer {...props} onTime={setSeconds} seekRequest={seekRequest} />;
}
