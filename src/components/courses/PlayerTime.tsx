"use client";

import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import LessonPlayer from "@/components/courses/LessonPlayer";

const PlayerTimeContext = createContext<{ seconds: number; setSeconds: (seconds: number) => void }>({ seconds: 0, setSeconds: () => {} });

/** Where the lesson's player is, shared with controls elsewhere on the page ("Copy link" at this moment). */
export function PlayerTimeProvider({ children }: { children: ReactNode }) {
  const [seconds, setSeconds] = useState(0);
  return <PlayerTimeContext.Provider value={{ seconds, setSeconds }}>{children}</PlayerTimeContext.Provider>;
}

/** Whole seconds into the video; 0 outside a provider. */
export function usePlayerSeconds(): number {
  return useContext(PlayerTimeContext).seconds;
}

/** The lesson player, reporting its position to the provider above it. */
export function TimedLessonPlayer(props: ComponentProps<typeof LessonPlayer>) {
  const { setSeconds } = useContext(PlayerTimeContext);
  return <LessonPlayer {...props} onTime={setSeconds} />;
}
