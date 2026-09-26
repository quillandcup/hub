import { requireAdmin } from "@/lib/supabase/api-auth";
import { bootstrapMonthFromCalendar, getMonthStart } from "@/lib/prickle-schedules";
import { NextRequest, NextResponse } from "next/server";

// Bootstraps (backports) prickle_schedules for a month from what's already on
// the prickle calendar (see bootstrapMonthFromCalendar), then immediately seeds
// the following month from the result. Works for the current month or any
// month the calendar sync covers -- e.g. next month once it's locked in on
// Google Calendar. Additive and safe to re-run: it skips any
// host+type+recurrence combination that already has a row.
//
// Body (all optional):
//   month                   "YYYY-MM-01"; defaults to the current month
//   dryRun                  true -> return the counts without writing anything
//   confirmMatchingProposed true -> also confirm existing `proposed` rows the calendar matches
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json().catch(() => ({}));
    const month: string = body.month || getMonthStart(new Date()).toISOString().slice(0, 10);
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
      return NextResponse.json({ error: "month must be a first-of-month date (YYYY-MM-01)" }, { status: 400 });
    }
    const confirmedBy = user.id === "service-role" || user.id === "cron" ? null : user.id;

    const result = await bootstrapMonthFromCalendar(supabase, month, confirmedBy, {
      dryRun: body.dryRun === true,
      confirmMatchingProposed: body.confirmMatchingProposed === true,
    });
    return NextResponse.json({ month, ...result });
  } catch (error: any) {
    console.error("Error bootstrapping prickle_schedules:", error);
    return NextResponse.json({ error: error.message || "Failed to bootstrap schedule" }, { status: 500 });
  }
}
