import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { parseBatch } from "@/lib/analytics/receive";
import { userAgentForStorage } from "@/lib/device-label";
import { SUDO_COOKIE_NAME, actingAsHeaderValue } from "@/lib/sudo-cookie";
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from "@/lib/with-timeout";

/**
 * Stores a batch of usage events for the signed-in member (lib/analytics/client.ts is the sender).
 * Each event is checked against the tracking plan in lib/analytics/events.ts: unknown events and
 * undeclared properties never reach the table. Retries are safe -- an event already stored
 * (same member and messageId) is skipped. Runs as the member, so RLS only lets it write their own
 * rows. Events sent while an admin views as a member are stored but flagged `sudo`.
 *
 * Sits beside app/api/track/page-view, which keeps feeding the access log and its page trail;
 * this one is the general event stream.
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await withTimeout(getCurrentUser(), AUTH_CHECK_TIMEOUT_MS);
  } catch {
    return NextResponse.json({ error: "Auth check timed out" }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const parsed = parseBatch(body, new Date(), userAgentForStorage(request.headers.get("user-agent")));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.rows.length === 0) return NextResponse.json({ stored: 0, rejected: parsed.rejected });

  const sudo = actingAsHeaderValue(request.cookies.get(SUDO_COOKIE_NAME)?.value, user.id) !== null;

  const supabase = await createClient();
  const { error } = await supabase.from("analytics_events").upsert(
    parsed.rows.map((row) => ({ ...row, user_id: user.id, sudo })),
    { onConflict: "user_id,message_id", ignoreDuplicates: true }
  );
  if (error) {
    console.error("Failed to record analytics events:", error.message);
    return NextResponse.json({ error: "Failed to record events" }, { status: 500 });
  }
  return NextResponse.json({ stored: parsed.rows.length, rejected: parsed.rejected });
}
