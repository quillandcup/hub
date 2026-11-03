import { clock } from "@/lib/clock";
import type { Repos } from "@/lib/data/repos";
import type { NewResendEvent } from "@/lib/data/resend";
import { projectEmails, STORED_EVENT_TYPES, type StoredEventType } from "@/lib/email-events";
import { chunk } from "@/lib/supabase/paginate";

/**
 * The pull half of the Resend import (docs/EMAIL_TIMELINE.md): the webhook is a latency optimization, never the
 * only path, so every night this lists the emails sent recently and records what the webhook may have missed
 * while it was down or misconfigured.
 *
 * The list endpoint reports each email's *last* event, not its history, so only facts that stay true can be
 * recovered: that it was sent, and where it ended up (delivered, bounced, complained, failed, delayed). An open
 * or a click missed by the webhook is gone; nothing here invents a time for one.
 */

const LIST_URL = "https://api.resend.com/emails";
const PAGE_SIZE = 100;
// Resend allows 2 requests a second.
const PAGE_PAUSE_MS = 600;
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 1000;
const PROJECT_CHUNK = 200;
/** A hard stop on pages, so a bad cursor can never loop: 200 pages is 20,000 emails. */
const MAX_PAGES = 200;

/** An email as the list endpoint reports it. */
export type ListedEmail = {
  id: string;
  to: string[] | null;
  from: string | null;
  subject: string | null;
  created_at: string;
  last_event: string | null;
};

/** Resend writes "2026-04-03 22:13:42.674981+00" here and ISO elsewhere. */
export function parseResendTime(value: string): string | null {
  const iso = value.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

type Fetch = typeof fetch;

/** Emails sent at or after `sinceIso`, newest first, following the pagination cursor. */
export async function listEmailsSince(apiKey: string, sinceIso: string, fetchImpl: Fetch = fetch): Promise<ListedEmail[]> {
  const emails: ListedEmail[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(LIST_URL);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (after) url.searchParams.set("after", after);

    let body: { data?: ListedEmail[]; has_more?: boolean } | null = null;
    for (let attempt = 1; ; attempt++) {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (response.ok) {
        body = await response.json();
        break;
      }
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await clock.sleep(retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_MS);
        continue;
      }
      // A key that can only send cannot list: say so, so the cron fails loudly instead of importing nothing.
      throw new Error(`Resend list emails responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const data = body?.data ?? [];
    let reachedOlder = false;
    for (const email of data) {
      const createdAt = parseResendTime(email.created_at);
      if (createdAt !== null && createdAt < sinceIso) reachedOlder = true;
      else emails.push(email);
    }
    if (reachedOlder || !body?.has_more || data.length === 0) break;
    after = data[data.length - 1].id;
    await clock.sleep(PAGE_PAUSE_MS);
  }
  return emails;
}

const PULLED_STATES = new Set<StoredEventType>(
  STORED_EVENT_TYPES.filter((type) => !["email.sent", "email.opened", "email.clicked"].includes(type)),
);

/**
 * The Bronze rows to add for a listed email: its "sent" and its final state, each only when Bronze has no event
 * of that type for the email yet (the webhook's own row is better than a recovered one). Times are the send time,
 * since the list doesn't say when the last event happened; `detail` says so.
 */
export function recoveredEvents(email: ListedEmail, have: Set<string>): NewResendEvent[] {
  const createdAt = parseResendTime(email.created_at);
  if (!createdAt) return [];
  const row = (type: StoredEventType, detail: string | null): NewResendEvent => ({
    event_id: `pull:${email.id}:${type}`,
    event_type: type,
    email_id: email.id,
    occurred_at: createdAt,
    recipients: (email.to ?? []).map((a) => a.toLowerCase()),
    from_address: email.from,
    subject: email.subject,
    detail,
    raw_payload: { source: "pull", email },
  });

  const events: NewResendEvent[] = [];
  if (!have.has("email.sent")) events.push(row("email.sent", null));
  const last = email.last_event ? (`email.${email.last_event}` as StoredEventType) : null;
  if (last && PULLED_STATES.has(last) && !have.has(last)) {
    events.push(row(last, "Recovered by the nightly import; the time is when the email was sent."));
  }
  return events;
}

export type PullResult = { listed: number; recovered: number; projected: number };

/** Lists the emails sent since `sinceIso`, stores what Bronze lacks and rebuilds their timeline rows. */
export async function pullEmailEvents(
  repos: Pick<Repos, "members" | "resendEvents" | "activities">,
  apiKey: string,
  sinceIso: string,
  fetchImpl: Fetch = fetch,
): Promise<PullResult> {
  const listed = await listEmailsSince(apiKey, sinceIso, fetchImpl);
  let recovered = 0;
  let projected = 0;
  for (const part of chunk(listed, PROJECT_CHUNK)) {
    const known = await repos.resendEvents.eventsForEmails(part.map((e) => e.id));
    const typesByEmail = new Map<string, Set<string>>();
    for (const event of known) typesByEmail.set(event.email_id, (typesByEmail.get(event.email_id) ?? new Set()).add(event.event_type));

    const missing = part.flatMap((email) => recoveredEvents(email, typesByEmail.get(email.id) ?? new Set()));
    await repos.resendEvents.record(missing);
    recovered += missing.length;
    projected += await projectEmails(repos, part.map((e) => e.id));
  }
  return { listed: listed.length, recovered, projected };
}
