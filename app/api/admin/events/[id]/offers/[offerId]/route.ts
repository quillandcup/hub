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
