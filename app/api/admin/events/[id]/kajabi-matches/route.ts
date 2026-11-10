import { createRepos } from "@/lib/data/repos";
import { findKajabiMatchesForEvent } from "@/lib/kajabi-event-matching";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Read-only: who bought this event's linked Kajabi offers and is not an attendee yet, purchases
// whose buyer has no member, and attendees with no ticket on record. Nothing is added here;
// the admin page adds the buyers they pick through the attendees route.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const repos = createRepos(auth.supabase);
  try {
    if (!(await repos.events.byId(id))) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json(await findKajabiMatchesForEvent(repos, id));
  } catch (error) {
    console.error("Error finding Kajabi matches for an event:", error);
    return NextResponse.json({ error: "Failed to find Kajabi matches" }, { status: 500 });
  }
}
