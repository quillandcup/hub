import { createRepos } from "@/lib/data/repos";
import { parseTicketInput } from "@/lib/event-tickets";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Adding an attendee auto-grants the event's linked badge (if any) -- see
// add_event_attendee() in 20260905010000_link_badges_to_events_and_attendees.sql. That's an
// atomic SQL function (not two separate inserts here) so the attendee row and the badge award
// can't drift apart if one half fails.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  if (!body.memberId) {
    return NextResponse.json({ error: "Missing required field: memberId" }, { status: 400 });
  }

  const ticket = parseTicketInput(body);
  if (ticket && "error" in ticket) return NextResponse.json({ error: ticket.error }, { status: 400 });

  const { error } = await supabase.rpc("add_event_attendee", {
    p_event_id: id,
    p_member_id: body.memberId,
    p_admin_id: (user.id !== "service-role" && user.id !== "cron" ? user.id : null) as string, // null: no admin (service role or cron)
  });

  if (error) {
    console.error("Error adding event attendee:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Metadata about the ticket, set after the atomic add (the function's signature stays as it is).
  if (ticket) {
    try {
      await createRepos(supabase).events.setAttendeeTicket(id, body.memberId, ticket);
    } catch (ticketError) {
      console.error("Error recording event attendee ticket:", ticketError);
      return NextResponse.json({ error: "Added, but the ticket could not be recorded" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
