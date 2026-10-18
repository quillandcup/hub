"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { ORG_TIMEZONE } from "@/lib/config";
import { effectiveFromForDate, isFutureDate } from "@/lib/prickle-join";

/**
 * Set the Zoom room link, meeting ID and passcode. With no `startDate` it applies from now; with one
 * (YYYY-MM-DD, after today) from the start of that day in the org timezone, so a prickle belongs to
 * the day it starts. Append-only: prickles that already started keep the setting they had (see
 * lib/prickle-join.ts), which keeps past calendar events accurate. The link must be https.
 */
export async function savePrickleJoin(input: { url: string; meetingId: string; passcode: string; startDate?: string }) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  const url = typeof input?.url === "string" ? input.url.trim() : "";
  const meetingId = typeof input?.meetingId === "string" ? input.meetingId.trim() : "";
  const passcode = typeof input?.passcode === "string" ? input.passcode.trim() : "";
  const startDate = typeof input?.startDate === "string" ? input.startDate.trim() : "";
  try {
    if (new URL(url).protocol !== "https:") throw new Error();
  } catch {
    return { error: "Enter the full https:// join link" };
  }

  const now = new Date();
  if (startDate && !isFutureDate(startDate, now, ORG_TIMEZONE)) {
    return { error: "Pick a start day after today, or leave it blank to start now" };
  }
  const effectiveFrom = startDate ? effectiveFromForDate(startDate, ORG_TIMEZONE) : now;

  const { error } = await auth.supabase.from("prickle_join_settings").insert({
    join_url: url,
    meeting_id: meetingId || null,
    passcode: passcode || null,
    effective_from: effectiveFrom.toISOString(),
    created_by: auth.user.id,
  });
  if (error) {
    console.error("savePrickleJoin failed", error);
    return { error: "Couldn't save the join link" };
  }
  revalidatePath("/admin/prickle-join");
  return { success: true as const };
}

/** Take back a change scheduled for a future day. Anything already in effect stays (RLS refuses). */
export async function removeScheduledPrickleJoin(id: string) {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (typeof id !== "string" || !id) return { error: "Invalid setting" };

  const { data, error } = await auth.supabase.from("prickle_join_settings").delete().eq("id", id).select("id");
  if (error) {
    console.error("removeScheduledPrickleJoin failed", error);
    return { error: "Couldn't remove it" };
  }
  if (!data?.length) return { error: "That change already took effect, so it can't be removed" };
  revalidatePath("/admin/prickle-join");
  return { success: true as const };
}
