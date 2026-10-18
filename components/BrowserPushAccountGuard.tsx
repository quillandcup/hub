"use client";

import { useEffect } from "react";
import { syncBrowserPush } from "@/lib/browser-push";

/** Also runs when entering with a different account without using our sign-out button. */
export function BrowserPushAccountGuard({ memberId, isSudo, publicKey }: { memberId: string; isSudo: boolean; publicKey: string | null }) {
  useEffect(() => {
    const controller = new AbortController();
    if (!isSudo) {
      syncBrowserPush(memberId, publicKey, controller.signal).catch((error) => console.error("[notifications] Checking browser ownership failed", error));
    }
    return () => controller.abort();
  }, [memberId, isSudo, publicKey]);
  return null;
}
