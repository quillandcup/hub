import { requireAdmin } from "@/lib/supabase/api-auth";
import { createRepos } from "@/lib/data/repos";
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
    const { slack_user_id, reason } = body;

    if (!slack_user_id) {
      return NextResponse.json(
        { error: "slack_user_id is required" },
        { status: 400 }
      );
    }

    const validReasons = ['non_member', 'bot', 'guest'];
    if (reason && !validReasons.includes(reason)) {
      return NextResponse.json(
        { error: `reason must be one of: ${validReasons.join(', ')}` },
        { status: 400 }
      );
    }

    // Already ignored is fine
    await createRepos(supabase).slackWorkspace.ignoreUser(slack_user_id, reason || 'non_member');

    return NextResponse.json({
      success: true,
      message: "Slack user marked as non-member",
    });
  } catch (error: any) {
    console.error("Error skipping Slack user:", error);
    return NextResponse.json(
      { error: error.message || "Failed to skip user" },
      { status: 500 }
    );
  }
}
