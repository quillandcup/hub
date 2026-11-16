"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction, type AdminActionAuth } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { withAction } from "@/lib/analytics/server";
import { triggerAttendanceReprocessing } from "@/lib/processing/trigger";

export type ZoomMeetingChoice = "kept" | "ignored" | "undecided";

export interface DecideZoomMeetingsInput {
  /** `kept` and `ignored` write a decision; `undecided` takes the decision back (the account's default applies again). */
  choice: ZoomMeetingChoice;
  /** `instance`: each target is one meeting's uuid. `series`: each target is a Zoom meeting id, covering every past and future occurrence. */
  scope: "instance" | "series";
  targets: { zoomAccount: string; zoomKey: string }[];
}

const MAX_TARGETS = 500;

type Result = { success: true; decided: number; reprocessError?: string } | { error: string };

async function decideZoomMeetingsImpl(auth: Extract<AdminActionAuth, { ok: true }>, input: DecideZoomMeetingsInput): Promise<Result> {
  const { supabase, user } = auth;

  if (!["kept", "ignored", "undecided"].includes(input?.choice) || !["instance", "series"].includes(input?.scope)) {
    return { error: "Invalid request" };
  }
  const targets = Array.isArray(input.targets) ? input.targets : [];
  if (targets.length === 0) return { error: "Pick at least one meeting" };
  if (targets.length > MAX_TARGETS) return { error: `Pick at most ${MAX_TARGETS} meetings at a time` };
  if (targets.some((t) => typeof t?.zoomAccount !== "string" || typeof t?.zoomKey !== "string" || !t.zoomKey)) {
    return { error: "Invalid request" };
  }

  const zoom = createRepos(supabase).zoom;
  try {
    const accounts = new Set((await zoom.accounts()).map((a) => a.id));
    if (targets.some((t) => !accounts.has(t.zoomAccount))) return { error: "Unknown Zoom account" };

    // Work out the stretch of time the decision touches before writing: reprocessing that range is what puts Silver right.
    let from: string | null = null;
    let to: string | null = null;
    for (const t of targets) {
      const span = await zoom.meetingSpan({ zoomAccount: t.zoomAccount, scope: input.scope, zoomKey: t.zoomKey });
      if (!span) continue;
      if (from === null || span.from < from) from = span.from;
      if (to === null || span.to > to) to = span.to;
    }

    for (const t of targets) {
      if (input.choice === "undecided") {
        await zoom.clearDecision({ zoomAccount: t.zoomAccount, scope: input.scope, zoomKey: t.zoomKey });
      } else {
        await zoom.setDecision({ zoomAccount: t.zoomAccount, scope: input.scope, zoomKey: t.zoomKey, decision: input.choice, decidedBy: user.id });
      }
    }

    revalidatePath("/admin/hygiene/zoom-meetings");
    revalidatePath("/admin/hygiene");

    // Silver is rebuilt from Bronze with the new decision: a kept meeting gets its prickle and attendance, an ignored one loses them.
    if (from !== null && to !== null) {
      try {
        await triggerAttendanceReprocessing({ from: new Date(from), to: new Date(to) });
      } catch (error) {
        console.error("Error reprocessing attendance after a Zoom meeting decision:", error);
        return { success: true, decided: targets.length, reprocessError: error instanceof Error ? error.message : String(error) };
      }
    }
    return { success: true, decided: targets.length };
  } catch (error) {
    console.error("Error saving Zoom meeting decisions:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** Keeps or ignores Zoom meetings (or every occurrence of a link) and reprocesses the attendance they cover. */
export async function decideZoomMeetings(input: DecideZoomMeetingsInput): Promise<Result> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("zoom_meetings_decided", () => decideZoomMeetingsImpl(auth, input));
}
