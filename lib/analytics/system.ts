import { createRepos } from "@/lib/data/repos";
import { SERVER_ONLY_EVENTS, validateProperties, type EventName, type EventProps } from "@/lib/analytics/events";

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
    // Deliberately not filtered by "leave me out of statistics" (lib/analytics/opt-out.ts): a send is something the
    // app did, a record that it sent the notification, not how the member used the Hub. The rates report leaves
    // opted-out members' sends out of its counts instead (20270310000000_notification_rates_opt_out.sql).
    const rows = events.flatMap((e) => {
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
    await createRepos(supabase).analyticsEvents.record(rows);
  } catch (error) {
    console.error("[analytics] Recording system events failed:", error instanceof Error ? error.message : error);
  }
}
