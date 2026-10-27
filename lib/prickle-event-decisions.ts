import type { Db } from "@/lib/data/db";

/**
 * Stores an admin's choice for a calendar prickle as its event's decision (`unmatched_calendar_events`),
 * because that is what `/api/process/calendar` applies on every reprocess; changing only the prickle
 * would be undone by the next run. An event matched automatically has no such row yet, so one is added.
 * Returns an `{ error }` to hand back to the caller, or null when it saved.
 */
export async function saveEventDecision(
  supabase: Db,
  calendarEventId: string,
  choice: { resolved_type_id: string } | { resolved_host_id: string }
): Promise<{ error: string } | null> {
  const decision = { status: "resolved", resolved_at: new Date().toISOString(), ...choice };
  const { data: existing, error: findError } = await supabase.from("unmatched_calendar_events").select("id").eq("calendar_event_id", calendarEventId);
  if (findError) return { error: "Couldn't save the change" };

  if (existing && existing.length > 0) {
    const { error } = await supabase.from("unmatched_calendar_events").update(decision).eq("calendar_event_id", calendarEventId);
    return error ? { error: "Couldn't save the change" } : null;
  }
  const { data: event } = await supabase.schema("bronze").from("calendar_events").select("summary").eq("id", calendarEventId).maybeSingle();
  if (!event?.summary) return { error: "The calendar event is gone, so the change wouldn't last" };
  const { error } = await supabase.from("unmatched_calendar_events").insert({ calendar_event_id: calendarEventId, raw_summary: event.summary, ...decision });
  return error ? { error: "Couldn't save the change" } : null;
}
