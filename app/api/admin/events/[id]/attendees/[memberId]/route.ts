import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Removing an attendee also revokes the event's linked badge (if any) -- see
// remove_event_attendee() in 20260905010000_link_badges_to_events_and_attendees.sql.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id, memberId } = await params;

  const { error } = await supabase.rpc("remove_event_attendee", { p_event_id: id, p_member_id: memberId });

  if (error) {
    console.error("Error removing event attendee:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
