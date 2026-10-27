"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendTestCheckinDM, type CheckinDMKind } from "@/lib/prickle-checkin-dms";
import { prickleTitle } from "@/lib/domain/prickle";
import { createRepos } from "@/lib/data/repos";
import { revalidatePath } from "next/cache";

/**
 * Sends the signed-in admin a test check-in or check-out DM for this prickle, to see what members
 * get without waiting for the cron (see sendTestCheckinDM). Always to the admin's own Slack and
 * email: refused in sudo, so a test can't land in a member's inbox.
 */
export async function sendTestPrickleDM(prickleId: string, kind: CheckinDMKind) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (kind !== "prickle_checkin" && kind !== "prickle_checkout") return { error: "Unknown DM kind" };

  const identity = await getEffectiveIdentity(auth.user);
  if (!identity) return { error: "Your account has no member record to send to." };
  if (identity.isSudo) return { error: "Exit sudo first: test sends go to your own Slack and email." };

  const prickle = await createRepos(auth.supabase).prickles.byId(prickleId);
  const type = prickle?.type;
  if (!prickle || !type?.name) return { error: "Prickle not found" };

  // Service role for the Slack user match (bronze.slack_users), as the cron does; every query is
  // scoped to the admin's own member id.
  const result = await sendTestCheckinDM(
    createServiceRoleClient(),
    identity.memberId,
    { id: prickle.id, typeName: type.name, title: prickleTitle(prickle) },
    kind
  );
  return "error" in result ? { error: result.error } : { success: true as const, delivered: result.delivered };
}

/**
 * Changes a calendar prickle's type, for a calendar event that was filed under the wrong one. The
 * choice is stored as the event's resolved decision (`unmatched_calendar_events`), because that is
 * what `/api/process/calendar` applies on every reprocess; changing only the prickle would be
 * undone by the next run. An event matched automatically has no such row yet, so one is added.
 */
export async function changePrickleType(prickleId: string, typeId: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const repos = createRepos(auth.supabase);
  const [prickle, types] = await Promise.all([repos.prickles.byId(prickleId), repos.prickles.types()]);
  if (!prickle) return { error: "Prickle not found" };
  if (!prickle.calendarEventId) return { error: "Only prickles made from a calendar event can change type here" };
  if (!types.some((t) => t.id === typeId)) return { error: "Unknown prickle type" };

  const decision = { status: "resolved", resolved_type_id: typeId, resolved_at: new Date().toISOString() };
  const { data: existing, error: findError } = await auth.supabase
    .from("unmatched_calendar_events")
    .select("id")
    .eq("calendar_event_id", prickle.calendarEventId);
  if (findError) return { error: "Couldn't save the change" };

  if (existing && existing.length > 0) {
    const { error } = await auth.supabase.from("unmatched_calendar_events").update(decision).eq("calendar_event_id", prickle.calendarEventId);
    if (error) return { error: "Couldn't save the change" };
  } else {
    const { data: event } = await auth.supabase.schema("bronze").from("calendar_events").select("summary").eq("id", prickle.calendarEventId).maybeSingle();
    if (!event?.summary) return { error: "The calendar event is gone, so the change wouldn't last" };
    const { error } = await auth.supabase
      .from("unmatched_calendar_events")
      .insert({ calendar_event_id: prickle.calendarEventId, raw_summary: event.summary, ...decision });
    if (error) return { error: "Couldn't save the change" };
  }

  await repos.prickles.setType(prickleId, typeId);
  revalidatePath(`/admin/prickles/${prickleId}`);
  return { success: true as const };
}
