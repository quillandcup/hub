import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { member_id } = body;

    if (!member_id) {
      return NextResponse.json({ error: "Missing required field: member_id" }, { status: 400 });
    }

    const touch = await createRepos(supabase).outreach.logTouch(
      member_id,
      user.id !== "service-role" && user.id !== "cron" ? user.id : null
    );

    // Best-effort mirror into the activity log — log-and-continue on
    // failure, same convention as the writing-progress mirror in
    // app/(member)/projects/actions.ts. outreach_touches remains the source
    // of truth regardless.
    const actorUserId = user.id !== "service-role" && user.id !== "cron" ? user.id : null;
    await createRepos(supabase)
      .activities.record({
        memberId: member_id,
        type: "outreach_touch_logged",
        category: "communication",
        title: "Outreach touch logged",
        actorKind: "staff",
        actorUserId,
        engagementValue: 0, // our action, not the lead's engagement signal
        occurredAt: touch.touched_at,
        source: "outreach_touches",
        relatedId: touch.id,
      })
      .catch((activityError) => console.error("Error mirroring outreach touch to member_activities:", activityError));

    return NextResponse.json({ touch }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to log outreach touch" },
      { status: 500 }
    );
  }
}
