import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { botOf } from "@/lib/chat/load";
import { withLinkPreviews } from "@/lib/chat/link-preview-cards";
import { cachedUnfurlImage } from "@/lib/chat/unfurl-image-cache";
import { unfurlImageUrls } from "@/lib/chat/unfurl-images";
import { parseUnfurls } from "@/lib/chat/unfurls";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { hitRateLimits } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/** A picture is fetched for at most the fetch's own time budget (lib/net/safe-fetch.ts), with room to spare. */
export const maxDuration = 30;

/** A busy conversation can show dozens of pictures at once, and the browser keeps what it fetched; this stops a loop, not a reader. */
const LIMIT = { windowSeconds: 10 * 60, maxHits: 600 };

/** What the browser may keep: it is the viewer's own copy (`private`), and a message's pictures rarely change. */
const CACHE = "private, max-age=86400";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
/** Whatever went wrong at the other end, the viewer is told nothing about it. */
const unavailable = () => NextResponse.json({ error: "Not available" }, { status: 502, headers: { "Cache-Control": "no-store" } });

/**
 * A picture under a Slack message (link preview, app card, app logo, author of a quoted message), fetched for the viewer
 * so the host that serves it never learns who looked (docs/SLACK_BRIDGED_CHAT.md, "Pictures"). The request names a message and
 * a position, never an address: the message is read as the viewer (row-level security decides whether they can read it at
 * all), its pictures are listed in the order the renderer used (lib/chat/unfurl-images.ts), and the one at that position is fetched
 * by `fetchImage` (behind the stored-copy cache of lib/chat/unfurl-image-cache.ts, read only after those checks), which refuses anything but a public https address and anything but a raster image. What goes back is the
 * bytes and a type we sniffed ourselves, never a header from the other end.
 */
export async function GET(request: NextRequest) {
  const messageId = request.nextUrl.searchParams.get("m");
  const indexParam = request.nextUrl.searchParams.get("i");
  if (!messageId || !isId(messageId, "msg") || !indexParam || !/^\d{1,3}$/.test(indexParam)) return notFound();
  const index = Number(indexParam);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  // Read as the viewer: a message they can't read has no content for them, so there is nothing to fetch.
  const repos = createRepos(await createClient());
  const content = await repos.chat.unfurlContext(messageId).catch((error: Error) => {
    console.error("[chat] reading the cards of %s failed:", messageId, error.message);
    return null;
  });
  if (!content) return notFound();
  // The Hub's own link previews are read as the viewer too, and come after Slack's cards, as the renderer lists them.
  const previews = await repos.chatLinkPreviews.forMessages([messageId]).catch((error: Error) => {
    console.error("[chat] reading the link previews of %s failed:", messageId, error.message);
    return null;
  });
  // And the cards its author removed, whose pictures are not served. With no answer, nothing is.
  const hidden = await repos.chatLinkPreviews.hiddenKeys([messageId]).catch((error: Error) => {
    console.error("[chat] reading the removed cards of %s failed:", messageId, error.message);
    return null;
  });
  if (!previews || !hidden) return notFound();

  const bot = botOf(content.bot);
  const parsed = parseUnfurls({ attachments: content.attachments, blocks: content.blocks }, { bot: bot !== null, body: content.body });
  const url = unfurlImageUrls(withLinkPreviews(parsed.unfurls, previews.get(messageId), hidden.get(messageId)), bot?.icon ?? null)[index];
  if (!url) return notFound();

  if (!(await hitRateLimits(createRepos(createServiceRoleClient()), [{ bucket: `chat_unfurl_images:user:${user.id}`, ...LIMIT }]))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(LIMIT.windowSeconds) } });
  }

  // Only now, after the viewer's own read of the message and the rate limit, do bytes come from our copy or the host.
  const image = await cachedUnfurlImage(createServiceRoleClient().storage, url);
  if (!image.ok) {
    // The reason is one of our own codes; the address can carry a token, so it is not logged.
    // The upstream status (a number) says whether a host refused us (403) or lost the file (404).
    console.error("[chat] unfurl picture of %s (#%d) not served: %s%s", messageId, index, image.reason, image.status ? ` (upstream HTTP ${image.status})` : "");
    return unavailable();
  }
  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": CACHE,
    },
  });
}
