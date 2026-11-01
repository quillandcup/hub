"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ORG_TIMEZONE } from "@/lib/config";

const TimezoneContext = createContext<string>(ORG_TIMEZONE);

/**
 * Gives every client component below the viewer's time zone (`resolveTimeZone` in lib/timezone.ts),
 * resolved on the server so the first client render matches the server's HTML.
 */
export function TimezoneProvider({ zone, children }: { zone: string; children: ReactNode }) {
  return <TimezoneContext.Provider value={zone}>{children}</TimezoneContext.Provider>;
}

/** The viewer's time zone, for formatting dates in a client component. */
export function useTimeZone(): string {
  return useContext(TimezoneContext);
}
