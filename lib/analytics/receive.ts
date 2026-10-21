import { SERVER_ONLY_EVENTS, isEventName, validateProperties } from "@/lib/analytics/events";
import { templateRoute } from "@/lib/analytics/route";

export const MAX_EVENTS_PER_REQUEST = 50;
/** Older than this, an event's clock is more likely wrong than the event is real. */
const MAX_AGE_MS = 24 * 60 * 60_000;
const VIEWPORTS = new Set(["sm", "md", "lg"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventRow {
  message_id: string;
  session_id: string;
  event: string;
  properties: Record<string, boolean | number | string>;
  context: Record<string, string>;
  occurred_at: string;
}

export interface Rejection {
  index: number;
  reason: string;
}

/**
 * Turns a browser batch into rows to store: checks each event against the tracking plan
 * (lib/analytics/events.ts), rebuilds `context` from known fields only, and fixes the client's
 * clock. `timestamp` is when the client says it happened and `sentAt` is its clock when it
 * sent the batch, so `receivedAt - sentAt` is the skew; subtracting it puts `occurred_at` on
 * the server's clock. Events that fail are returned as rejections and the rest are kept.
 */
export function parseBatch(
  body: unknown,
  receivedAt: Date,
  userAgent: string | null
): { rows: EventRow[]; rejected: Rejection[] } | { error: string } {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const sentAtMs = typeof input?.sentAt === "string" ? Date.parse(input.sentAt) : NaN;
  if (!input || !Array.isArray(input.events) || Number.isNaN(sentAtMs)) return { error: "Invalid batch" };
  if (input.events.length > MAX_EVENTS_PER_REQUEST) return { error: "Too many events" };

  const skewMs = receivedAt.getTime() - sentAtMs;
  const rows: EventRow[] = [];
  const rejected: Rejection[] = [];
  input.events.forEach((raw, index) => {
    const e = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const fail = (reason: string) => rejected.push({ index, reason });
    if (!isEventName(e.event)) return fail("unknown event");
    if (SERVER_ONLY_EVENTS.has(e.event)) return fail("server-only event");
    if (typeof e.messageId !== "string" || !UUID.test(e.messageId)) return fail("bad messageId");
    if (typeof e.sessionId !== "string" || !UUID.test(e.sessionId)) return fail("bad sessionId");
    const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    if (Number.isNaN(at)) return fail("bad timestamp");
    const props = validateProperties(e.event, e.properties);
    if (!props.ok) return fail(props.reason);

    const occurred = Math.min(at + skewMs, receivedAt.getTime());
    if (receivedAt.getTime() - occurred > MAX_AGE_MS) return fail("too old");

    const ctx = e.context && typeof e.context === "object" ? (e.context as Record<string, unknown>) : {};
    const context: Record<string, string> = {};
    const route = templateRoute(ctx.route);
    if (route) context.route = route;
    if (typeof ctx.viewport === "string" && VIEWPORTS.has(ctx.viewport)) context.viewport = ctx.viewport;
    if (userAgent) context.user_agent = userAgent;

    rows.push({
      message_id: e.messageId,
      session_id: e.sessionId,
      event: e.event,
      properties: props.properties,
      context,
      occurred_at: new Date(occurred).toISOString(),
    });
  });
  return { rows, rejected };
}
