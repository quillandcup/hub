"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * "Back to <tabbed page>" links on a detail page return to the tab the member came from (e.g.
 * My Prickles → All Prickles → a prickle → back to All Prickles). The tabbed page keeps its
 * active tab in the URL (Tabs `syncToUrl`) and renders RememberTabUrl, which records that URL
 * for the browser tab's session; ReturnToTabLink on the detail page goes back to it.
 */
function storageKey(path: string): string {
  return `returnToTab:${path}`;
}

/** Render on the tabbed page (inside a Suspense boundary, for useSearchParams). */
export function RememberTabUrl({ path }: { path: string }) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(path), query ? `${path}?${query}` : path);
    } catch {
      // Storage unavailable (private mode, blocked site data): the back link uses its fallback.
    }
  }, [path, query]);

  return null;
}

function rememberedUrl(path: string): string | null {
  try {
    const url = sessionStorage.getItem(storageKey(path));
    // Only ever a URL on that same page, as RememberTabUrl wrote it.
    return url === path || url?.startsWith(`${path}?`) ? url : null;
  } catch {
    return null;
  }
}

export function ReturnToTabLink({
  path,
  fallbackHref,
  className,
  children,
}: {
  /** The tabbed page's pathname, e.g. "/my-prickles". */
  path: string;
  fallbackHref: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Leave modified clicks (new tab/window) to the browser, using the fallback href.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const url = rememberedUrl(path);
    if (!url) return;
    event.preventDefault();
    router.push(url);
  }

  return (
    <Link href={fallbackHref} onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}
