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

type Admin = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;

/**
 * Stores an admin's choice for a calendar prickle as its event's decision (`unmatched_calendar_events`),
 * because that is what `/api/process/calendar` applies on every reprocess; changing only the prickle
 * would be undone by the next run. An event matched automatically has no such row yet, so one is added.
 */
async function saveEventDecision(auth: Admin, calendarEventId: string, choice: { resolved_type_id: string } | { resolved_host_id: string }) {
  const decision = { status: "resolved", resolved_at: new Date().toISOString(), ...choice };
  const { data: existing, error: findError } = await auth.supabase.from("unmatched_calendar_events").select("id").eq("calendar_event_id", calendarEventId);
  if (findError) return { error: "Couldn't save the change" };

  if (existing && existing.length > 0) {
    const { error } = await auth.supabase.from("unmatched_calendar_events").update(decision).eq("calendar_event_id", calendarEventId);
    return error ? { error: "Couldn't save the change" } : null;
  }
  const { data: event } = await auth.supabase.schema("bronze").from("calendar_events").select("summary").eq("id", calendarEventId).maybeSingle();
  if (!event?.summary) return { error: "The calendar event is gone, so the change wouldn't last" };
  const { error } = await auth.supabase.from("unmatched_calendar_events").insert({ calendar_event_id: calendarEventId, raw_summary: event.summary, ...decision });
  return error ? { error: "Couldn't save the change" } : null;
}

/** Changes a calendar prickle's type, for a calendar event that was filed under the wrong one. */
export async function changePrickleType(prickleId: string, typeId: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const repos = createRepos(auth.supabase);
  const [prickle, types] = await Promise.all([repos.prickles.byId(prickleId), repos.prickles.types()]);
  if (!prickle) return { error: "Prickle not found" };
  if (!prickle.calendarEventId) return { error: "Only prickles made from a calendar event can change type here" };
  if (!types.some((t) => t.id === typeId)) return { error: "Unknown prickle type" };

  const failed = await saveEventDecision(auth, prickle.calendarEventId, { resolved_type_id: typeId });
  if (failed) return failed;
  await repos.prickles.setType(prickleId, typeId);
  revalidatePath(`/admin/prickles/${prickleId}`);
  return { success: true as const };
}

/** Changes a calendar prickle's host, for a "w/Name" the title spells in a way that matches no member (or the wrong one). */
export async function changePrickleHost(prickleId: string, memberId: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const repos = createRepos(auth.supabase);
  const [prickle, member] = await Promise.all([repos.prickles.byId(prickleId), repos.members.byId(memberId)]);
  if (!prickle) return { error: "Prickle not found" };
  if (!prickle.calendarEventId) return { error: "Only prickles made from a calendar event can change host here" };
  if (!member) return { error: "Member not found" };

  const failed = await saveEventDecision(auth, prickle.calendarEventId, { resolved_host_id: memberId });
  if (failed) return failed;
  await repos.prickles.setHost(prickleId, memberId);
  revalidatePath(`/admin/prickles/${prickleId}`);
  return { success: true as const };
}
