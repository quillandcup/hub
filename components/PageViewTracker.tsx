"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PAGE_VIEW_PATH } from "@/lib/page-views";
import { watchGaTag, type GaTagState, type GaTagWindow } from "@/lib/analytics/ga-tag-state";

/**
 * Reports each page the signed-in user actually lands on (full load or client-side navigation)
 * to the access log. Prefetches never run this, which is the point: the proxy can't tell them
 * from visits. Best-effort; a failed report is dropped.
 *
 * Each report also says whether the Google Analytics tag was running (lib/analytics/ga-tag-state.ts). The tag
 * loads after the page is interactive, so a view that finds it not yet running waits a bounded moment for it
 * (never past leaving the page: the cleanup sends what is known) before saying it did not load.
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    const send = (ga_tag: GaTagState) => {
      fetch(PAGE_VIEW_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, ga_tag }),
        keepalive: true,
      }).catch(() => {});
    };
    const watch = watchGaTag(window as unknown as GaTagWindow & { document: Document }, process.env.NEXT_PUBLIC_GA_ID, send);
    // Navigating on, unmounting or closing the tab must not lose a view that is still waiting.
    window.addEventListener("pagehide", watch.settleNow);
    return () => {
      window.removeEventListener("pagehide", watch.settleNow);
      watch.settleNow();
    };
  }, [pathname]);

  return null;
}
