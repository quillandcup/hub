import { templateRoute } from "@/lib/analytics/route";
import { SESSION_COOKIE } from "@/lib/analytics/session-cookie";
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

/**
 * Tells the server which visit this is (lib/analytics/session-cookie.ts), so an outcome it records
 * joins the clicks that led to it. Set only while tracking is allowed, expires with the visit.
 */
function writeSessionCookie(id: string | null): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = id
      ? `${SESSION_COOKIE}=${id}; Path=/; Max-Age=${SESSION_IDLE_MS / 1000}; SameSite=Lax${secure}`
      : `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    // No cookies available: server outcomes just won't be recorded.
  }
}

/** Callbacks waiting for tracking to be switched on (see `trackWhenEnabled`). */
const whenEnabled = new Set<() => void>();

export function setTrackingEnabled(on: boolean): void {
  enabled = on;
  if (on) {
    for (const send of whenEnabled) send();
    whenEnabled.clear();
  }
  if (!on) {
    whenEnabled.clear();
    queue = [];
    if (timer) clearTimeout(timer);
    timer = null;
    memorySession = null;
    writeSessionCookie(null);
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
  writeSessionCookie(session.id);
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

/**
 * Like `track`, for a page that reports as it mounts: on a first load that effect can run a moment
 * before consent has been read and tracking switched on, and `track` would drop it. This sends it
 * when tracking turns on, and never if it doesn't (nothing is held for a visitor who hasn't
 * agreed: the callback is just dropped when tracking is switched off or the page unmounts).
 * Returns the function that cancels it.
 */
export function trackWhenEnabled<N extends EventName>(name: N, properties: EventProps<N>): () => void {
  if (enabled) {
    track(name, properties);
    return () => {};
  }
  const send = () => track(name, properties);
  whenEnabled.add(send);
  return () => void whenEnabled.delete(send);
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
