import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  CALENDAR_FEED_NAME,
  FEED_REFRESH_MINUTES,
  loadCalendarFeedEvents,
  parseFeedToken,
} from "@/lib/calendar-feed";
import { renderICalendar } from "@/lib/ical";

/**
 * A member's subscribable calendar feed: GET /api/calendar/feed/<token>.ics.
 *
 * Calendar apps (Google, Apple, Outlook) fetch this with no session, so the secret token in the
 * URL is the credential. It's looked up with the service role, and everything served is scoped to
 * that token's member. An unknown token (never issued, or replaced via "Generate new link") is a
 * 404, which calendar apps treat as a dead subscription.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = parseFeedToken((await params).token);
  if (!token) return new NextResponse("Not found", { status: 404 });

  const supabase = createServiceRoleClient();
  const { data: row, error } = await supabase
    .from("calendar_feed_tokens")
    .select("member_id, first_fetched_at")
    .eq("token", token)
    .maybeSingle();
  if (error) {
    console.error("calendar feed: token lookup failed", error);
    return new NextResponse("Calendar feed unavailable", { status: 500 });
  }
  if (!row) return new NextResponse("Not found", { status: 404 });

  // First fetch = a calendar app subscribed. Recorded once (the audit trigger logs it); never on
  // later polls, which would write a row every refresh.
  if (!row.first_fetched_at) {
    const { error: fetchedError } = await supabase
      .from("calendar_feed_tokens")
      .update({ first_fetched_at: new Date().toISOString() })
      .eq("token", token)
      .is("first_fetched_at", null);
    if (fetchedError) console.error("calendar feed: failed to record first fetch", fetchedError);
  }

  try {
    const now = new Date();
    const events = await loadCalendarFeedEvents(supabase, row.member_id, request.nextUrl.origin, now);
    const body = renderICalendar(
      {
        name: CALENDAR_FEED_NAME,
        description: "Prickles you host and prickles you've committed to, from Hedgie Hub.",
        refreshMinutes: FEED_REFRESH_MINUTES,
        events,
      },
      now
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="hedgie-hub-prickles.ics"',
        // Personal data behind a secret URL: never cache in a shared cache.
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    console.error("calendar feed: failed to build feed", { memberId: row.member_id, err });
    return new NextResponse("Calendar feed unavailable", { status: 500 });
  }
}
