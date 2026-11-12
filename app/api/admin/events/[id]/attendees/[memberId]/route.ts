import { createRepos } from "@/lib/data/repos";
import { parseTicketInput, SET_TICKET_REFUSALS } from "@/lib/event-tickets";
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

// Records how an attendee got in (purchased, comped, gifted); an empty source clears it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;
  const { id, memberId } = await params;

  const body = await request.json().catch(() => undefined);
  if (body === undefined || body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ticket = parseTicketInput(body);
  if (!ticket) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  if ("error" in ticket) return NextResponse.json({ error: ticket.error }, { status: 400 });

  let result;
  try {
    result = await createRepos(supabase).events.setAttendeeTicket(id, memberId, ticket);
  } catch (error) {
    console.error("Error updating event attendee ticket:", error);
    return NextResponse.json({ error: "Failed to update the ticket" }, { status: 500 });
  }
  if (result === "not_attendee") return NextResponse.json({ error: "Not an attendee of this event" }, { status: 404 });
  if (result !== "set") return NextResponse.json({ error: SET_TICKET_REFUSALS[result] }, { status: 400 });

  return NextResponse.json({ success: true });
}
