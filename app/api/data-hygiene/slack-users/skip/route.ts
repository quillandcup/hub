import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const body = await request.json();
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

    // Insert into ignored users
    const { error } = await supabase
      .from("ignored_slack_users")
      .insert({
        user_id: slack_user_id,
        reason: reason || 'non_member',
      });

    if (error) {
      // If duplicate, that's fine (already ignored)
      if (error.code !== '23505') {
        throw error;
      }
    }

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
