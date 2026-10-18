"use client";

import { useEffect } from "react";
import { clearUnownedBrowserPush } from "@/lib/browser-push";

/** Also runs when entering with a different account without using our sign-out button. */
export function BrowserPushAccountGuard({ memberId, isSudo }: { memberId: string; isSudo: boolean }) {
  useEffect(() => {
    if (!isSudo) {
      clearUnownedBrowserPush().catch((error) => console.error("[notifications] Checking browser ownership failed", error));
    }
  }, [memberId, isSudo]);
  return null;
}
