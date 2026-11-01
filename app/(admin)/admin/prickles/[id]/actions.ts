"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendTestCheckinDM, type CheckinDMKind } from "@/lib/prickle-checkin-dms";
import { prickleTitle } from "@/lib/domain/prickle";
import { createRepos } from "@/lib/data/repos";
import { applyPrickleEdits, type PrickleEdits } from "@/lib/prickle-edits";
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
 * Saves an admin's edit of a calendar prickle from the prickle page. The work is `applyPrickleEdits`, which the
 * event page uses too, so the two pages edit the same decision (see there).
 */
export async function updatePrickle(prickleId: string, edits: PrickleEdits) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const result = await applyPrickleEdits(auth.supabase, prickleId, edits);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/admin/prickles/${prickleId}`);
  return { success: true as const };
}
