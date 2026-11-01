import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

const VALID_STATUSES = ["hot", "warm", "cold"] as const;

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { member_id, status } = body;

    if (!member_id || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: "Missing or invalid fields: member_id, status (hot|warm|cold)" },
        { status: 400 }
      );
    }

    const lead = await createRepos(supabase).outreach.setLeadStatus(
      member_id,
      status,
      user.id !== "service-role" && user.id !== "cron" ? user.id : null
    );

    return NextResponse.json({ lead });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update outreach lead" },
      { status: 500 }
    );
  }
}
