"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendTestCheckinDM, type CheckinDMKind } from "@/lib/prickle-checkin-dms";
import { prickleTitle } from "@/lib/domain/prickle";
import { createRepos } from "@/lib/data/repos";
import { loadEventDecision, saveEventDecision, type EventDecisionChoice } from "@/lib/prickle-event-decisions";
import { triggerReprocessing } from "@/lib/processing/trigger";
import type { PrickleEdits } from "@/components/PrickleEditForm";
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
 * Saves an admin's edit of a calendar prickle: its type, host, title, description and guest speaker. They are kept
 * as the calendar event's decision (see saveEventDecision) because the sync rebuilds every calendar prickle from the
 * calendar and applies the decision on top. Only what really changed is saved, so a form saved untouched sets no
 * override; text emptied goes back to following the calendar, which the sync fills in again straight away.
 */
export async function updatePrickle(prickleId: string, edits: PrickleEdits) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const repos = createRepos(auth.supabase);
  const [prickle, types] = await Promise.all([repos.prickles.byId(prickleId), repos.prickles.types()]);
  if (!prickle) return { error: "Prickle not found" };
  if (!prickle.calendarEventId) return { error: "Only prickles made from a calendar event can be edited here" };
  if (edits.typeId !== undefined && !types.some((t) => t.id === edits.typeId)) return { error: "Unknown prickle type" };
  if (edits.hostId !== undefined && !(await repos.members.byId(edits.hostId))) return { error: "Member not found" };

  const decision = await loadEventDecision(auth.supabase, prickle.calendarEventId);
  const choice: EventDecisionChoice = {};
  const immediate: { title?: string | null; description?: string | null; guestSpeaker?: string | null } = {};
  let followsCalendar = false;

  if (edits.typeId !== undefined && edits.typeId !== prickle.typeId) choice.resolved_type_id = edits.typeId;
  if (edits.hostId !== undefined && edits.hostId !== prickle.hostId) choice.resolved_host_id = edits.hostId;

  const texts = [
    ["title", edits.title, prickle.title, decision.resolved_title, "resolved_title"],
    ["description", edits.description, prickle.description, decision.resolved_description, "resolved_description"],
    ["guestSpeaker", edits.guestSpeaker, prickle.guestSpeaker, decision.resolved_guest_speaker, "resolved_guest_speaker"],
  ] as const;
  for (const [field, edited, current, overridden, column] of texts) {
    if (edited === undefined) continue;
    const value = edited?.trim() || null;
    if (value === null) {
      if (overridden !== null) {
        choice[column] = null; // follow the calendar again
        followsCalendar = true;
      }
    } else if (value !== (current?.trim() || null)) {
      choice[column] = value;
      immediate[field] = value;
    }
  }

  if (Object.keys(choice).length === 0) return { success: true as const };

  const failed = await saveEventDecision(auth.supabase, prickle.calendarEventId, choice);
  if (failed) return failed;

  if (choice.resolved_type_id) await repos.prickles.setType(prickleId, choice.resolved_type_id);
  if (choice.resolved_host_id) await repos.prickles.setHost(prickleId, choice.resolved_host_id);
  if (Object.keys(immediate).length > 0) await repos.prickles.setText(prickleId, immediate);

  // A new type changes what the calendar title makes of the title and the guest speaker, and text that follows the
  // calendar again has to be taken from it: reprocess the days around this prickle.
  if (choice.resolved_type_id || followsCalendar) {
    const day = 24 * 60 * 60 * 1000;
    await triggerReprocessing("prickle_types", "local", {
      dateRange: { from: new Date(new Date(prickle.startTime).getTime() - day), to: new Date(new Date(prickle.endTime).getTime() + day) },
    });
  }

  revalidatePath(`/admin/prickles/${prickleId}`);
  return { success: true as const };
}
