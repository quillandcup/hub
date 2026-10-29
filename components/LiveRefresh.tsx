"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authenticateRealtime } from "@/lib/chat/live";

/** Changes right behind the first one in a burst (a sync writes several rows) fold into one refresh. */
const REFRESH_DELAY_MS = 500;

type Change = { eventType: string; new: Record<string, unknown> | null };

/**
 * Keeps a server-rendered page current: when rows of `table` change, re-renders the page
 * (`router.refresh()`, so scroll position and client state stay). Renders nothing.
 *
 * Realtime applies the signed-in user's RLS, so only rows they can read arrive; the events are only
 * a signal, and what is shown is re-read through the page's own access-checked queries. It refreshes
 * again after a reconnect and when the tab comes back to the front, so anything missed while the
 * socket was down is caught.
 *
 * `within` limits it to rows whose `column` falls in [from, to) (ISO instants), e.g. the prickles of
 * the week on screen, so a change elsewhere doesn't refresh the page. A delete carries only the id, so
 * it always counts.
 */
export default function LiveRefresh({
  table,
  within,
}: {
  table: string;
  within?: { column: string; from: string; to: string };
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const column = within?.column;
  const from = within?.from;
  const to = within?.to;

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, REFRESH_DELAY_MS);
    };
    const relevant = (change: Change) => {
      if (!column || !from || !to) return true;
      const value = change.new?.[column];
      if (typeof value !== "string") return true;
      const at = new Date(value).getTime();
      return at >= new Date(from).getTime() && at < new Date(to).getTime();
    };

    let cancelled = false;
    let subscribedBefore = false;
    let subscription: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      await authenticateRealtime(supabase);
      if (cancelled) return;
      subscription = supabase
        .channel(`live:${table}:${from ?? ""}:${to ?? ""}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, (p) => {
          if (relevant(p as unknown as Change)) refresh();
        })
        .subscribe((status, err) => {
          if (status !== "SUBSCRIBED") {
            if (status !== "CLOSED") console.warn(`[live] ${table} updates:`, status, err?.message ?? "");
            return;
          }
          // A re-subscribe means changes may have been missed while disconnected.
          if (subscribedBefore) refresh();
          subscribedBefore = true;
        });
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      cancelled = true;
      if (subscription) void supabase.removeChannel(subscription);
    };
  }, [table, column, from, to, router]);

  return null;
}
