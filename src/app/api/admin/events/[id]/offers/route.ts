import { overlapMessage, parseWindow } from "@/lib/event-offer-window";
import { createRepos } from "@/lib/data/repos";
import { offerDetailOf } from "@/lib/offer-coverage";
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
    const [offers, linked, events] = await Promise.all([
      repos.billing.kajabiOfferRows(),
      repos.events.linkedOffers(),
      repos.events.listWithPhotoCounts(),
    ]);
    const titleOf = new Map(events.map((e) => [e.id, e.title]));
    const rows = offers
      .map((o) => {
        const links = linked.filter((l) => l.kajabi_offer_id === o.kajabi_offer_id);
        const here = links.find((l) => l.event_id === id);
        return {
          kajabiOfferId: o.kajabi_offer_id,
          name: o.name ?? "Unnamed offer",
          detail: offerDetailOf(o.kajabi_offer_id, o.name, o.data),
          linkedEventId: here ? id : null,
          purchasedFrom: here?.purchased_from ?? null,
          purchasedUntil: here?.purchased_until ?? null,
          // Where else the offer is linked: it can be linked again with its own purchase dates.
          otherEvents: links.filter((l) => l.event_id !== id).map((l) => ({ title: titleOf.get(l.event_id) ?? "another event", purchasedFrom: l.purchased_from, purchasedUntil: l.purchased_until })),
        };
      })
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
  const fields = body && typeof body === "object" ? (body as { kajabiOfferId?: unknown; purchasedFrom?: unknown; purchasedUntil?: unknown }) : {};
  const offerId = fields.kajabiOfferId;
  if (typeof offerId !== "string" || !offerId.trim()) {
    return NextResponse.json({ error: "Missing required field: kajabiOfferId" }, { status: 400 });
  }

  const parsed = parseWindow(fields);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const repos = createRepos(auth.supabase);
  try {
    if (!(await repos.events.byId(id))) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if ((await repos.billing.kajabiOffersByIds([offerId])).length === 0) {
      return NextResponse.json({ error: "No such Kajabi offer" }, { status: 404 });
    }
    const createdBy = auth.user.id !== "service-role" && auth.user.id !== "cron" ? auth.user.id : null;
    const result = await repos.events.linkOffer(id, offerId, createdBy, parsed.window);
    if (!result.linked) {
      return NextResponse.json({ error: overlapMessage(), eventId: result.eventId }, { status: 409 });
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Error linking event offer:", error);
    return NextResponse.json({ error: "Failed to link the offer" }, { status: 500 });
  }
}
