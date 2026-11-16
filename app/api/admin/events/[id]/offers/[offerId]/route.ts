import { overlapMessage, parseWindow } from "@/lib/event-offer-window";
import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// Unlinking an offer leaves the attendees it added where they are.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, offerId } = await params;

  try {
    const removed = await createRepos(auth.supabase).events.unlinkOffer(id, offerId);
    if (!removed) return NextResponse.json({ error: "That offer is not linked to this event" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unlinking event offer:", error);
    return NextResponse.json({ error: "Failed to unlink the offer" }, { status: 500 });
  }
}

// Changes (or clears) the purchase days a linked offer counts for this event.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, offerId } = await params;

  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const parsed = parseWindow(body as { purchasedFrom?: unknown; purchasedUntil?: unknown });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await createRepos(auth.supabase).events.setOfferWindow(id, offerId, parsed.window);
    if (!result.updated) {
      if (result.reason === "not_linked") return NextResponse.json({ error: "That offer is not linked to this event" }, { status: 404 });
      return NextResponse.json({ error: overlapMessage(), eventId: result.eventId }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error changing event offer window:", error);
    return NextResponse.json({ error: "Failed to change the purchase dates" }, { status: 500 });
  }
}
