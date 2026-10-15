"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PAGE_VIEW_PATH } from "@/lib/page-views";

/**
 * Reports each page the signed-in user actually lands on (full load or client-side navigation)
 * to the access log. Prefetches never run this, which is the point: the proxy can't tell them
 * from visits. Best-effort; a failed report is dropped.
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    fetch(PAGE_VIEW_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [pathname]);

  return null;
}
