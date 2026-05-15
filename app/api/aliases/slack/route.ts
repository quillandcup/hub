import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { member_id, slack_user_id } = body;

    if (!member_id || !slack_user_id) {
      return NextResponse.json(
        { error: "member_id and slack_user_id are required" },
        { status: 400 }
      );
    }

    // Verify member exists
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("id", member_id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Verify Slack user exists
    const { data: slackUser } = await supabase
      .schema('bronze').from("slack_users")
      .select("user_id")
      .eq("user_id", slack_user_id)
      .single();

    if (!slackUser) {
      return NextResponse.json({ error: "Slack user not found" }, { status: 404 });
    }

    // Insert alias (or update if already exists)
    const { error } = await supabase
      .from("member_name_aliases")
      .upsert({
        member_id,
        alias: slack_user_id,
        source: "slack",
      }, {
        onConflict: "alias",
      });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Slack alias created successfully",
    });
  } catch (error: any) {
    console.error("Error creating Slack alias:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create alias" },
      { status: 500 }
    );
  }
}
