import { requireAdmin } from "@/lib/supabase/api-auth";
import { getMonthStart, getNextMonthStart, seedNextMonthSchedules, validateScheduleInput } from "@/lib/prickle-schedules";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const month = request.nextUrl.searchParams.get("month");
  if (!month) return NextResponse.json({ error: "month query parameter is required" }, { status: 400 });

  const now = new Date();
  const nextMonth = getNextMonthStart(now).toISOString().slice(0, 10);
  if (month === nextMonth) {
    const currentMonth = getMonthStart(now).toISOString().slice(0, 10);
    await seedNextMonthSchedules(supabase, currentMonth, nextMonth);
  }

  const { data: schedules, error } = await supabase
    .from("prickle_schedules")
    .select(`
      *,
      member:members(id, name, email),
      prickle_type:prickle_types(id, name)
    `)
    .eq("month", month)
    .is("deleted_at", null)
    .order("created_at");

  if (error) {
    console.error("Error fetching prickle_schedules:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ schedules });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { host_id, status, notes } = body;

    if (!host_id) return NextResponse.json({ error: "host_id is required" }, { status: 400 });

    const validationError = validateScheduleInput({
      typeId: body.type_id,
      month: body.month,
      recurrenceType: body.recurrence_type,
      dayOfWeek: body.day_of_week ?? null,
      recurrenceAnchorDate: body.recurrence_anchor_date ?? null,
      weekOfMonth: body.week_of_month ?? null,
      eventDate: body.event_date ?? null,
      startTimeLocal: body.start_time_local,
    });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    if (status && !["proposed", "confirmed", "declined"].includes(status)) {
      return NextResponse.json({ error: "status must be one of: proposed, confirmed, declined" }, { status: 400 });
    }

    const insert: Record<string, unknown> = {
      host_id,
      type_id: body.type_id,
      month: body.month,
      recurrence_type: body.recurrence_type,
      day_of_week: body.day_of_week ?? null,
      recurrence_anchor_date: body.recurrence_anchor_date ?? null,
      week_of_month: body.week_of_month ?? null,
      event_date: body.event_date ?? null,
      start_time_local: body.start_time_local,
      timezone: body.timezone || "America/New_York",
      notes: notes || null,
      status: status || "proposed",
      updated_by: user.id !== "service-role" ? user.id : null,
    };
    if (insert.status === "confirmed") {
      insert.confirmed_by = user.id !== "service-role" ? user.id : null;
      insert.confirmed_at = new Date().toISOString();
    }

    const { data: schedule, error } = await supabase
      .from("prickle_schedules")
      .insert(insert)
      .select(`
        *,
        member:members(id, name, email),
        prickle_type:prickle_types(id, name)
      `)
      .single();

    if (error) {
      console.error("Error creating prickle_schedule:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to create schedule" }, { status: 500 });
  }
}
