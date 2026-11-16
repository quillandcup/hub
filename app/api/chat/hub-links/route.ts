import { NextRequest, NextResponse } from "next/server";
import { chatCaller } from "@/lib/chat/caller";
import { hubLinkCardsFor } from "@/lib/chat/hub-link-flag";
import { loadHubLinkCard } from "@/lib/chat/hub-link-card";
import { parseHubLink } from "@/lib/chat/hub-links";
import { APP_URL } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";
import { hitRateLimits } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** A card asks once when it appears, so a busy conversation stays well inside this. */
const LIMIT = { windowSeconds: 10 * 60, maxHits: 600 };

/** Per viewer, so never shared and never kept. */
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * What the card for a link to the Hub shows the signed-in viewer (`?url=<the address as written>`; docs/SLACK_BRIDGED_CHAT.md, "Hub links").
 * Every read is made as the viewer, so row-level security applies the rule of the page the link goes to: a quoted message is read only by
 * someone who can read it, and what they may not see is the same `stub` as a message that is not there. Behind the viewer's own
 * `chat_link_cards` flag (404 without it, as if there were no such route). An address that is not one of the Hub's card links is a 404 too.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("url");
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  if (!address || address.length > 2000 || !parseHubLink(address, APP_URL)) return notFound();

  const caller = await chatCaller();
  if (!caller) return NextResponse.json({ error: "Not available" }, { status: 401, headers: NO_STORE });
  if (!(await hubLinkCardsFor(caller)())) return notFound();

  if (!(await hitRateLimits(createRepos(createServiceRoleClient()), [{ bucket: `chat_hub_cards:user:${caller.userId}`, ...LIMIT }]))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(LIMIT.windowSeconds) } });
  }

  const card = await loadHubLinkCard(createRepos(await createClient()), caller.identity, address, APP_URL);
  return card ? NextResponse.json(card, { headers: NO_STORE }) : notFound();
}
