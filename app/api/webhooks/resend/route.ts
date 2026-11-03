import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import { projectEmails, toResendEvent, verifyResendSignature } from "@/lib/email-events";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const maxDuration = 60;

/**
 * Resend webhook: an email was sent, delivered, opened, clicked, bounced... (docs/EMAIL_TIMELINE.md).
 *
 * Verifies the Svix signature on the raw body, stores the event in Bronze (`bronze.resend_events`, idempotent on
 * the delivery's `svix-id`) and rebuilds that one email's member timeline rows. A webhook alone is never the
 * only path: the nightly /api/reconcile/email pull recovers whatever this missed.
 *
 * A database failure answers 500 so Resend retries (the retry is a no-op for what was already stored); an
 * event type we don't keep answers 200, since a retry would change nothing.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = verifyResendSignature(
    body,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    process.env.RESEND_WEBHOOK_SECRET,
    Math.floor(clock.now() / 1000),
  );
  if (!signature.valid) {
    console.error(`Invalid Resend webhook: ${signature.reason}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = toResendEvent(payload, request.headers.get("svix-id") ?? "");
  if (!event || !event.event_id) return NextResponse.json({ received: true, stored: false });

  try {
    const repos = createRepos(createServiceRoleClient());
    await repos.resendEvents.record([event]);
    const rows = await projectEmails(repos, [event.email_id]);
    return NextResponse.json({ received: true, stored: true, rows });
  } catch (error) {
    console.error("Error processing Resend webhook:", error);
    return NextResponse.json({ error: "Failed to process event" }, { status: 500 });
  }
}
