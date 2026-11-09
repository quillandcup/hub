import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";

// The Kajabi offers that sell this event. Linking one lets "Find Kajabi matches" list its buyers.

/** The linked offers with their names, and every other offer an admin could link. */
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
    const [offers, linked] = await Promise.all([
      repos.billing.kajabiOfferNames().then((names) => repos.billing.kajabiOffersByName(names)),
      repos.events.linkedOffers(),
    ]);
    const linkedTo = new Map(linked.map((l) => [l.kajabi_offer_id, l.event_id]));
    const rows = offers
      .map((o) => ({ kajabiOfferId: o.kajabi_offer_id, name: o.name ?? "Unnamed offer", linkedEventId: linkedTo.get(o.kajabi_offer_id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({
      linked: rows.filter((o) => o.linkedEventId === id),
      available: rows.filter((o) => o.linkedEventId === null),
    });
  } catch (error) {
    console.error("Error loading event offers:", error);
    return NextResponse.json({ error: "Failed to load the Kajabi offers" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await request.json().catch(() => undefined);
  const offerId = body && typeof body === "object" ? (body as { kajabiOfferId?: unknown }).kajabiOfferId : undefined;
  if (typeof offerId !== "string" || !offerId.trim()) {
    return NextResponse.json({ error: "Missing required field: kajabiOfferId" }, { status: 400 });
  }

  const repos = createRepos(auth.supabase);
  try {
    if (!(await repos.events.byId(id))) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if ((await repos.billing.kajabiOffersByIds([offerId])).length === 0) {
      return NextResponse.json({ error: "No such Kajabi offer" }, { status: 404 });
    }
    const createdBy = auth.user.id !== "service-role" && auth.user.id !== "cron" ? auth.user.id : null;
    const result = await repos.events.linkOffer(id, offerId, createdBy);
    if (!result.linked) {
      return NextResponse.json({ error: "That offer already sells another event", eventId: result.eventId }, { status: 409 });
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Error linking event offer:", error);
    return NextResponse.json({ error: "Failed to link the offer" }, { status: 500 });
  }
}
