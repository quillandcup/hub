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

    return NextResponse.json({ touch }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to log outreach touch" },
      { status: 500 }
    );
  }
}
