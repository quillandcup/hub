"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { withSecondaryTime } from "@/lib/secondary-time";

const SecondaryTimezoneContext = createContext<string | null>(null);

/** Gives every client component below the member's secondary time zone (null when they have none). */
export function SecondaryTimezoneProvider({ zone, children }: { zone: string | null; children: ReactNode }) {
  return <SecondaryTimezoneContext.Provider value={zone}>{children}</SecondaryTimezoneContext.Provider>;
}

export function useSecondaryTimezone(): string | null {
  return useContext(SecondaryTimezoneContext);
}

/** `(text, instant, viewerZone) => text with the secondary reading`, for time strings built in a client component. */
export function useWithSecondaryTime() {
  const zone = useSecondaryTimezone();
  return useCallback((text: string, instant: Date | string, timeZone: string) => withSecondaryTime(text, instant, timeZone, zone), [zone]);
}

/** For server components: renders `text`, plus the secondary reading when the member has one. */
export function WithSecondaryTime({ text, instant, timeZone }: { text: string; instant: Date | string; timeZone: string }) {
  return <>{useWithSecondaryTime()(text, instant, timeZone)}</>;
}
