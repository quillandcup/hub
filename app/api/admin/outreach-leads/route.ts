import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES = ["hot", "warm", "cold"] as const;

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { member_id, status } = body;

    if (!member_id || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: "Missing or invalid fields: member_id, status (hot|warm|cold)" },
        { status: 400 }
      );
    }

    const { data: lead, error } = await supabase
      .from("outreach_leads")
      .upsert(
        {
          member_id,
          status,
          updated_by: user.id !== "service-role" && user.id !== "cron" ? user.id : null,
        },
        { onConflict: "member_id" }
      )
      .select("*")
      .single();

    if (error) {
      console.error("Error updating outreach lead:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ lead });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update outreach lead" },
      { status: 500 }
    );
  }
}
