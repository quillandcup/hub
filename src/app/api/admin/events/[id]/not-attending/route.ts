import { createRepos } from "@/lib/data/repos";
import { MARK_NOT_ATTENDING_REFUSALS, parseNotAttendingInput } from "@/lib/event-not-attending";
import { isId } from "@/lib/ids";
import { requireApiPermission } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Marks a ticket buyer as not attending the event (a forfeited deposit, a ticket moved elsewhere), with
// the reason. The marked buyer leaves "Bought a ticket, not an attendee" in Find Kajabi matches.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiPermission(request, "events.manage");
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase, user } = auth;
  const { id } = await params;

  const body = await request.json().catch(() => undefined);
  if (body === undefined || body === null || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const memberId = (body as { memberId?: unknown }).memberId;
  if (typeof memberId !== "string" || !isId(memberId, "mbr")) {
    return NextResponse.json({ error: "Missing or invalid memberId" }, { status: 400 });
  }
  const input = parseNotAttendingInput(body);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const repos = createRepos(supabase);
  try {
    if (!(await repos.events.byId(id))) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (!(await repos.members.byId(memberId))) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const createdBy = user.id !== "service-role" && user.id !== "cron" ? user.id : null;
    const result = await repos.events.markNotAttending(id, memberId, input.reason, input.note, createdBy);
    if (result === "already_attendee") return NextResponse.json({ error: MARK_NOT_ATTENDING_REFUSALS.already_attendee }, { status: 409 });
    if (result !== "set") return NextResponse.json({ error: MARK_NOT_ATTENDING_REFUSALS[result] }, { status: 400 });
  } catch (error) {
    console.error("Error marking an event buyer as not attending:", error);
    return NextResponse.json({ error: "Failed to mark the buyer as not attending" }, { status: 500 });
  }
  return NextResponse.json({ success: true }, { status: 201 });
}
