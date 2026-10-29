import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { ORG_TIMEZONE } from "@/lib/config";
import { monthOf } from "@/lib/events-agenda";
import { fetchPastEventPrickles } from "@/lib/event-prickles";
import { isValidTimeZone } from "@/lib/time-zone";

/**
 * The past events page's other half: the prickles of listed types that started in one month and have ended
 * (`?month=YYYY-MM`). The page loads its events at once and asks for a month's prickles as it is opened, and ahead
 * of time when someone points at it.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await getUserFeaturePreviews(user.id)).includes("events")) return NextResponse.json({ error: "Not available" }, { status: 403 });

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });

  const tzPref = await getUserTimezonePreference();
  const timeZone = isValidTimeZone(tzPref) ? tzPref : ORG_TIMEZONE;
  try {
    const prickles = await fetchPastEventPrickles(await createClient(), monthOf(`${month}-01`), timeZone, new Date());
    return NextResponse.json({ prickles }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("past event prickles failed", month, error);
    return NextResponse.json({ error: "Could not load sessions" }, { status: 500 });
  }
}
