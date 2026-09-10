import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { member_id } = body;

    if (!member_id) {
      return NextResponse.json({ error: "Missing required field: member_id" }, { status: 400 });
    }

    const { data: touch, error } = await supabase
      .from("outreach_touches")
      .insert({
        member_id,
        touched_by: user.id !== "service-role" && user.id !== "cron" ? user.id : null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error logging outreach touch:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Best-effort mirror into the activity log — log-and-continue on
    // failure, same convention as the writing-progress mirror in
    // app/(member)/projects/actions.ts. outreach_touches remains the source
    // of truth regardless.
    const actorUserId = user.id !== "service-role" && user.id !== "cron" ? user.id : null;
    const { error: activityError } = await supabase.from("member_activities").insert({
      member_id,
      activity_type: "outreach_touch_logged",
      activity_category: "communication",
      title: "Outreach touch logged",
      actor_kind: "staff",
      actor_user_id: actorUserId,
      engagement_value: 0, // our action, not the lead's engagement signal
      occurred_at: touch.touched_at,
      source: "outreach_touches",
      related_id: touch.id,
    });
    if (activityError) {
      console.error("Error mirroring outreach touch to member_activities:", activityError);
    }

    return NextResponse.json({ touch }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to log outreach touch" },
      { status: 500 }
    );
  }
}
