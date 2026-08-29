import { requireAdmin } from "@/lib/supabase/api-auth";
import { bootstrapMonthFromCalendar, getMonthStart } from "@/lib/prickle-schedules";
import { NextRequest, NextResponse } from "next/server";

// Bootstraps prickle_schedules for a month from what's already on the
// prickle calendar (see bootstrapMonthFromCalendar), then immediately seeds
// next month from the result. Meant as a one-time kickoff for a month that
// has no self-declared schedule yet -- safe to re-run since it skips any
// host+type+recurrence combination that already has a row.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const month = body.month || getMonthStart(new Date()).toISOString().slice(0, 10);
    const confirmedBy = user.id === "service-role" || user.id === "cron" ? null : user.id;

    const result = await bootstrapMonthFromCalendar(supabase, month, confirmedBy);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error bootstrapping prickle_schedules:", error);
    return NextResponse.json({ error: error.message || "Failed to bootstrap schedule" }, { status: 500 });
  }
}
