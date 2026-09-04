import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const QUEUE_TYPES = ["welcome_back", "hedgieversary", "hiatus_nudge"] as const;
const STATUSES = ["completed", "opted_out", "postponed"] as const;
// Opting out or postponing only makes sense for a one-time celebration —
// 'welcome_back'/'hiatus_nudge' occurrences only ever get marked 'completed'.
const STATUSES_REQUIRING_HEDGIEVERSARY = ["opted_out", "postponed"] as const;

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { queue_type, member_id, occurrence_key, status = "completed", postponedUntil } = body;

    if (!queue_type || !member_id || !occurrence_key) {
      return NextResponse.json(
        { error: "Missing required fields: queue_type, member_id, occurrence_key" },
        { status: 400 }
      );
    }
    if (!QUEUE_TYPES.includes(queue_type)) {
      return NextResponse.json({ error: `Invalid queue_type: ${queue_type}` }, { status: 400 });
    }
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }
    if (
      (STATUSES_REQUIRING_HEDGIEVERSARY as readonly string[]).includes(status) &&
      queue_type !== "hedgieversary"
    ) {
      return NextResponse.json(
        { error: `status "${status}" is only valid for queue_type "hedgieversary"` },
        { status: 400 }
      );
    }
    if (status === "postponed" && !postponedUntil) {
      return NextResponse.json(
        { error: "postponedUntil is required when status is 'postponed'" },
        { status: 400 }
      );
    }

    const { data: completion, error } = await supabase
      .from("admin_work_queue_completions")
      .upsert(
        {
          queue_type,
          member_id,
          occurrence_key,
          status,
          postponed_until: status === "postponed" ? postponedUntil : null,
          completed_by: user.id !== "service-role" && user.id !== "cron" ? user.id : null,
        },
        { onConflict: "queue_type,member_id,occurrence_key" }
      )
      .select("*")
      .single();

    if (error) {
      console.error("Error completing work queue item:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ completion }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to complete work queue item" },
      { status: 500 }
    );
  }
}
