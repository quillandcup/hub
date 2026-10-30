import { SERVER_ONLY_EVENTS, validateProperties, type EventName, type EventProps } from "@/lib/analytics/events";
import { optedOutUserIds } from "@/lib/analytics/opt-out";

/** What the app records on its own, outside any visit. */
export type SystemEventName = Extract<EventName, "notification_sent">;

export interface SystemEvent<N extends SystemEventName = SystemEventName> {
  /** The auth user the event is about (not the member id). */
  userId: string;
  event: N;
  properties: EventProps<N>;
}

/**
 * Records things the app did by itself (`source = 'system'`: a notification went to a member), with
 * no visit, so `session_id` is null. Pass a service-role client: there is no signed-in request to
 * write as. Best effort, never throws: a failure is logged and the caller carries on.
 */
export async function recordSystemEvents(supabase: any, events: SystemEvent[]): Promise<void> {
  try {
    const now = new Date().toISOString();
    // Members who chose "leave me out of statistics" (lib/analytics/opt-out.ts) get no row.
    const optedOut = await optedOutUserIds(supabase, [...new Set(events.map((e) => e.userId))]);
    const rows = events.flatMap((e) => {
      if (optedOut.has(e.userId)) return [];
      if (!SERVER_ONLY_EVENTS.has(e.event)) return [];
      const valid = validateProperties(e.event, e.properties);
      if (!valid.ok) return [];
      return [
        {
          message_id: crypto.randomUUID(),
          user_id: e.userId,
          session_id: null,
          source: "system",
          event: e.event,
          properties: valid.properties,
          context: {},
          sudo: false,
          occurred_at: now,
        },
      ];
    });
    if (rows.length === 0) return;
    const { error } = await supabase.from("analytics_events").insert(rows);
    if (error) console.error("[analytics] Recording system events failed:", error.message);
  } catch (error) {
    console.error("[analytics] Recording system events failed:", error instanceof Error ? error.message : error);
  }
}
