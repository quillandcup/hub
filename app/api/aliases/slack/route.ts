import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { member_id, slack_user_id } = body;

    if (!member_id || !slack_user_id) {
      return NextResponse.json(
        { error: "member_id and slack_user_id are required" },
        { status: 400 }
      );
    }

    // Verify member exists
    const member = await createRepos(supabase).members.byId(member_id);

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Verify Slack user exists
    const slackUser = await createRepos(supabase).slackUsers.byId(slack_user_id);

    if (!slackUser) {
      return NextResponse.json({ error: "Slack user not found" }, { status: 404 });
    }

    // Insert alias (or update if already exists)
    await createRepos(supabase).aliases.upsertName(member_id, slack_user_id, "slack");

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
