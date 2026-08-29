import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      host_id,
      type_id,
      status,
      day_of_week,
      recurrence_anchor_date,
      week_of_month,
      event_date,
      start_time_local,
      timezone,
      notes,
    } = body;

    if (status && !["proposed", "confirmed", "declined"].includes(status)) {
      return NextResponse.json({ error: "status must be one of: proposed, confirmed, declined" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      updated_by: user.id !== "service-role" ? user.id : null,
      updated_at: new Date().toISOString(),
    };
    if (host_id !== undefined) updates.host_id = host_id;
    if (type_id !== undefined) updates.type_id = type_id;
    if (day_of_week !== undefined) updates.day_of_week = day_of_week;
    if (recurrence_anchor_date !== undefined) updates.recurrence_anchor_date = recurrence_anchor_date;
    if (week_of_month !== undefined) updates.week_of_month = week_of_month;
    if (event_date !== undefined) updates.event_date = event_date;
    if (start_time_local !== undefined) updates.start_time_local = start_time_local;
    if (timezone !== undefined) updates.timezone = timezone;
    if (notes !== undefined) updates.notes = notes;

    // confirmed_by/confirmed_at always derive from the server-side auth
    // context, never from the request body.
    if (status !== undefined) {
      updates.status = status;
      if (status === "confirmed") {
        updates.confirmed_by = user.id !== "service-role" ? user.id : null;
        updates.confirmed_at = new Date().toISOString();
      } else {
        updates.confirmed_by = null;
        updates.confirmed_at = null;
      }
    }

    const { data: schedule, error } = await supabase
      .from("prickle_schedules")
      .update(updates)
      .eq("id", id)
      .is("deleted_at", null)
      .select(`
        *,
        member:members(id, name, email),
        prickle_type:prickle_types(id, name)
      `)
      .single();

    if (error) {
      console.error("Error updating prickle_schedule:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    return NextResponse.json({ schedule });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;

  try {
    const { id } = await params;

    // Soft delete only -- prickle_schedules rows are never hard-deleted, to
    // preserve hosting history.
    const { error } = await supabase
      .from("prickle_schedules")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id !== "service-role" ? user.id : null,
      })
      .eq("id", id);

    if (error) {
      console.error("Error soft-deleting prickle_schedule:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error processing request:", error);
    return NextResponse.json({ error: error.message || "Failed to delete schedule" }, { status: 500 });
  }
}
