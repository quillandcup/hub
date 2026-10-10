import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { parseUnsubscribeToken, setEmailEnabled } from "@/lib/email-unsubscribe";

/**
 * One-click unsubscribe (RFC 8058): the URL in a notification email's List-Unsubscribe header,
 * which Gmail, Apple Mail and others POST to when the member hits their own Unsubscribe button.
 * No sign-in; the signed token names the member and kind (lib/email-unsubscribe.ts). Only POST
 * changes anything: a GET (link scanners, prefetchers) must not unsubscribe anyone.
 */
export async function POST(request: NextRequest) {
  const parsed = parseUnsubscribeToken(request.nextUrl.searchParams.get("t"));
  if (!parsed) return NextResponse.json({ error: "Invalid unsubscribe link" }, { status: 400 });

  const saved = await setEmailEnabled(createServiceRoleClient(), parsed.memberId, parsed.kind, false);
  if (!saved) return NextResponse.json({ error: "Couldn't save that" }, { status: 500 });
  return NextResponse.json({ success: true });
}
