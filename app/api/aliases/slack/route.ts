import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      .from("bronze.slack_users")
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
