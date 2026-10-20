import { templateRoute } from "@/lib/analytics/route";
import type { EventName, EventProps } from "@/lib/analytics/events";

/**
 * Browser side of usage tracking: `track("onair_join_clicked", { live: true, room_size: 3 })`.
 *
 * Events wait in a small queue and go out in batches (every few seconds, and when the tab is
 * hidden or closed) to /api/track/events, so a click costs no request of its own and a click that
 * navigates away isn't lost. Each carries a `messageId`, so a batch that is sent twice is stored
 * once. Nothing is sent, or even queued, until `setTrackingEnabled(true)`, which the page does
 * once consent allows it (lib/analytics/consent.ts).
 */

export const TRACK_EVENTS_PATH = "/api/track/events";

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH = 50;
const MAX_QUEUE = 200;
/** A visit ends after this long without an event; the next one starts a new session. */
export const SESSION_IDLE_MS = 30 * 60_000;
const SESSION_STORAGE_KEY = "hub-analytics-session";

interface QueuedEvent {
  messageId: string;
  sessionId: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  context: { route: string | null; viewport: "sm" | "md" | "lg" };
}

let enabled = false;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let memorySession: { id: string; last: number } | null = null;

export function setTrackingEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    queue = [];
    if (timer) clearTimeout(timer);
    timer = null;
    memorySession = null;
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Storage can be blocked; there is nothing left to clear.
    }
  }
}

function currentSessionId(now: number): string {
  let session = memorySession;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) session = JSON.parse(raw);
  } catch {
    // Blocked storage or a bad value: fall back to the in-memory copy.
  }
  if (!session || typeof session.id !== "string" || now - session.last > SESSION_IDLE_MS) {
    session = { id: crypto.randomUUID(), last: now };
  }
  session = { id: session.id, last: now };
  memorySession = session;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Same: the in-memory copy carries the session.
  }
  return session.id;
}

function viewportClass(): "sm" | "md" | "lg" {
  const width = window.innerWidth;
  return width < 640 ? "sm" : width < 1024 ? "md" : "lg";
}

/** The current visit's session id (renewing it after a long idle). Null until tracking is enabled. */
export function getSessionId(): string | null {
  return enabled && typeof window !== "undefined" ? currentSessionId(Date.now()) : null;
}

/** Queues one event. A no-op until tracking is enabled and outside the browser. */
export function track<N extends EventName>(name: N, properties: EventProps<N>): void {
  if (!enabled || typeof window === "undefined") return;
  const now = Date.now();
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({
    messageId: crypto.randomUUID(),
    sessionId: currentSessionId(now),
    event: name,
    properties: properties as Record<string, unknown>,
    timestamp: new Date(now).toISOString(),
    context: { route: templateRoute(window.location.pathname), viewport: viewportClass() },
  });
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
}

/**
 * Sends what is queued. A network failure or 5xx puts the batch back for the next flush; a 4xx
 * (signed out, malformed) drops it, since resending can't help.
 */
export async function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!enabled || queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const res = await fetch(TRACK_EVENTS_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentAt: new Date().toISOString(), events: batch }),
      keepalive: true,
    });
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
  }
  if (queue.length > 0 && !timer) timer = setTimeout(() => void flush(), FLUSH_INTERVAL_MS);
}
