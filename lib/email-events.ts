import { createHmac, timingSafeEqual } from "crypto";
import type { NewActivity } from "@/lib/data/activities";
import type { Json } from "@/lib/data/database.types";
import type { Repos } from "@/lib/data/repos";
import type { NewResendEvent, ResendEvent } from "@/lib/data/resend";
import { isId } from "@/lib/ids";
import { chunk } from "@/lib/supabase/paginate";
import { webhookSecretRequired } from "@/lib/webhook-auth";

/**
 * Email events from Resend, onto the member timeline (docs/EMAIL_TIMELINE.md).
 *
 * Bronze (`bronze.resend_events`) keeps every event as Resend reported it, from the webhook and from the
 * nightly pull. Silver is `member_activities` rows with `source = "resend"`, rebuilt from Bronze one email at a
 * time (`projectEmails`): delete that email's rows, insert what its events say now. Idempotent, so a webhook
 * retry, the nightly pull and a manual reprocess all converge on the same rows.
 */

export const EMAIL_ACTIVITY_SOURCE = "resend";
/** Where an admin reads the email itself (its body, headers and delivery log). Not copied into the Hub. */
export const resendEmailUrl = (emailId: string) => `https://resend.com/emails/${encodeURIComponent(emailId)}`;

/** Resend event types that become Bronze rows. Anything else (`email.received` waits for replies) is ignored. */
export const STORED_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
] as const;
export type StoredEventType = (typeof STORED_EVENT_TYPES)[number];
const isStoredType = (type: unknown): type is StoredEventType => STORED_EVENT_TYPES.includes(type as StoredEventType);

// --- webhook signature -------------------------------------------------------------------------

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type ResendSignatureResult =
  | { valid: true }
  | { valid: false; reason: "missing" | "too_old" | "mismatch" | "not_configured" };

/**
 * Verifies a Resend webhook (Svix signing): HMAC-SHA256, keyed by the base64 part of the `whsec_` secret, over
 * `<svix-id>.<svix-timestamp>.<raw body>`; the header holds one or more space-separated `v1,<base64>`
 * signatures (more than one while a secret is being rotated). Needs the body exactly as received.
 *
 * With no secret, local dev and tests skip the check, but a deployed build rejects (`webhookSecretRequired`),
 * so a missing secret can't turn verification off.
 */
export function verifyResendSignature(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string | undefined,
  nowSeconds: number,
): ResendSignatureResult {
  if (!secret) return webhookSecretRequired() ? { valid: false, reason: "not_configured" } : { valid: true };
  if (!headers.id || !headers.timestamp || !headers.signature) return { valid: false, reason: "missing" };

  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: "too_old" };
  }

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  const matches = headers.signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches ? { valid: true } : { valid: false, reason: "mismatch" };
}

// --- payload -> Bronze row ---------------------------------------------------------------------

const asText = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** A clicked URL without its query string or fragment: a sign-in link carries a one-time token there. */
export function stripLinkSecrets(link: string): string {
  try {
    const url = new URL(link);
    return `${url.origin}${url.pathname}`;
  } catch {
    return link.split(/[?#]/)[0];
  }
}

/** The payload with the clicked link scrubbed, so the raw copy holds no token either. */
function scrubPayload(payload: Record<string, unknown>): Json {
  const data = payload.data as Record<string, unknown> | undefined;
  const click = data?.click as Record<string, unknown> | undefined;
  if (typeof click?.link !== "string") return payload as Json;
  return { ...payload, data: { ...data, click: { ...click, link: stripLinkSecrets(click.link) } } } as Json;
}

/** "Name <a@b>" reduces to "a@b"; plain string searching, since a pattern over uncontrolled text can backtrack badly. */
function addressOf(item: string): string {
  const open = item.lastIndexOf("<");
  const close = open === -1 ? -1 : item.indexOf(">", open);
  return close > open + 1 ? item.slice(open + 1, close) : item;
}

/** `to` as a list of lower-cased addresses, whether Resend sent an array or one string; "Name <a@b>" reduces to "a@b". */
function recipientsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => addressOf(item).trim().toLowerCase())
    .filter(Boolean);
}

/** Resend's tags arrive as an object, or as a list of `{ name, value }` from some endpoints. */
function tagsOf(value: unknown): Record<string, string> {
  const tags: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const tag of value) if (typeof tag?.name === "string" && typeof tag?.value === "string") tags[tag.name] = tag.value;
  } else if (value && typeof value === "object") {
    for (const [name, tag] of Object.entries(value)) if (typeof tag === "string") tags[name] = tag;
  }
  return tags;
}

/**
 * The Bronze row for one webhook payload, or null for an event type we don't keep or a payload without the
 * fields a row needs. `eventId` is the delivery's Svix id, which is what makes a retry a no-op.
 */
export function toResendEvent(payload: unknown, eventId: string): NewResendEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const data = body.data as Record<string, unknown> | undefined;
  const type = body.type;
  const emailId = asText(data?.email_id);
  if (!isStoredType(type) || !data || !emailId) return null;

  const click = data.click as Record<string, unknown> | undefined;
  const bounce = data.bounce as Record<string, unknown> | undefined;
  const failed = data.failed as Record<string, unknown> | undefined;
  const occurredAt = asText(type === "email.clicked" ? click?.timestamp : undefined) ?? asText(body.created_at);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) return null;

  return {
    event_id: eventId,
    event_type: type,
    email_id: emailId,
    occurred_at: new Date(occurredAt).toISOString(),
    recipients: recipientsOf(data.to),
    from_address: asText(data.from),
    subject: asText(data.subject),
    tags: tagsOf(data.tags),
    link: asText(click?.link) ? stripLinkSecrets(click!.link as string) : null,
    bounce_type: asText(bounce?.type),
    detail: asText(bounce?.message) ?? asText(failed?.reason) ?? null,
    raw_payload: scrubPayload(body),
  };
}

// --- Bronze events -> timeline rows ------------------------------------------------------------

const INSERT_CHUNK = 500;
const SUBJECT_FALLBACK = "(no subject)";
const DESCRIPTION_LIMIT = 200;

type EmailActivity = Omit<NewActivity, "memberId">;

/**
 * The timeline rows for ONE email, from all its events. Delivered is not a row of its own (it is noise on a
 * timeline); it appears on the "sent" row. Opens collapse to the first one with a count, since mail apps
 * that prefetch images report an open per device. Every click is a row. Engagement value is 0 on every row:
 * an open says little about a member, and tracking pixels would otherwise move their score.
 */
export function emailActivities(events: ResendEvent[]): EmailActivity[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
  const emailId = sorted[0].email_id;
  const subject = sorted.find((e) => e.subject)?.subject ?? SUBJECT_FALLBACK;
  const tags = (sorted.find((e) => e.tags && Object.keys(e.tags as object).length > 0)?.tags ?? {}) as Record<string, string>;
  const base = {
    category: "communication",
    source: EMAIL_ACTIVITY_SOURCE,
    relatedId: emailId,
    engagementValue: 0,
    actorKind: "system",
  };
  const common = { email_id: emailId, subject, kind: tags.kind ?? null, resend_url: resendEmailUrl(emailId) };
  const ofType = (type: StoredEventType) => sorted.filter((e) => e.event_type === type);

  const rows: EmailActivity[] = [];

  const sent = ofType("email.sent")[0] ?? sorted[0];
  const delivered = ofType("email.delivered")[0];
  rows.push({
    ...base,
    type: "email_sent",
    title: `Email sent: ${subject}`,
    description: sent.from_address ? `From ${sent.from_address}` : null,
    occurredAt: sent.occurred_at,
    data: { ...common, from: sent.from_address, delivered_at: delivered?.occurred_at ?? null },
  });

  const opens = ofType("email.opened");
  if (opens.length > 0) {
    rows.push({
      ...base,
      type: "email_opened",
      title: `Opened: ${subject}`,
      description: opens.length > 1 ? `Opened ${opens.length} times` : null,
      occurredAt: opens[0].occurred_at,
      data: { ...common, open_count: opens.length, last_opened_at: opens[opens.length - 1].occurred_at },
    });
  }

  for (const click of ofType("email.clicked")) {
    rows.push({
      ...base,
      type: "email_clicked",
      title: `Clicked a link in: ${subject}`,
      description: click.link,
      occurredAt: click.occurred_at,
      data: { ...common, link: click.link },
    });
  }

  for (const bounce of ofType("email.bounced")) {
    rows.push({
      ...base,
      type: "email_bounced",
      title: `Bounced: ${subject}`,
      description: [bounce.bounce_type, bounce.detail].filter(Boolean).join(": ").slice(0, DESCRIPTION_LIMIT) || null,
      occurredAt: bounce.occurred_at,
      data: { ...common, bounce_type: bounce.bounce_type },
    });
  }

  for (const complaint of ofType("email.complained")) {
    rows.push({
      ...base,
      type: "email_complained",
      title: `Marked as spam: ${subject}`,
      description: null,
      occurredAt: complaint.occurred_at,
      data: common,
    });
  }

  for (const failure of [...ofType("email.failed"), ...ofType("email.suppressed"), ...ofType("email.delivery_delayed")]) {
    rows.push({
      ...base,
      type: "email_failed",
      title: `${failure.event_type === "email.delivery_delayed" ? "Delayed" : "Not delivered"}: ${subject}`,
      description: failure.detail?.slice(0, DESCRIPTION_LIMIT) ?? null,
      occurredAt: failure.occurred_at,
      data: { ...common, reason: failure.event_type.replace("email.", "") },
    });
  }

  return rows;
}

/**
 * Who each email was for: the member named by its `member` tag when that member exists, otherwise the member
 * whose address it went to (addresses are stored lower-cased, as members' are). One lookup of each kind for all
 * the emails. An email nobody matches (a deleted member) has no entry; its events stay in Bronze and are
 * projected on the next run after the member exists.
 */
export async function membersForEmails(
  repos: Pick<Repos, "members">,
  byEmail: Map<string, ResendEvent[]>,
): Promise<Map<string, string>> {
  const taggedOf = (events: ResendEvent[]) => events.map((e) => (e.tags as Record<string, string> | null)?.member).find((id) => isId(id, "mbr"));
  const tagged = new Set([...byEmail.values()].map(taggedOf).filter((id): id is string => Boolean(id)));
  const addresses = new Set([...byEmail.values()].flatMap((events) => events.flatMap((e) => e.recipients)));

  const [existing, owners] = await Promise.all([
    tagged.size > 0 ? repos.members.byIds([...tagged]) : [],
    addresses.size > 0 ? repos.members.byEmails([...addresses]) : [],
  ]);
  const existingIds = new Set(existing.map((m) => m.id));
  const idByAddress = new Map(owners.map((m) => [m.email.toLowerCase(), m.id]));

  const result = new Map<string, string>();
  for (const [emailId, events] of byEmail) {
    const tag = taggedOf(events);
    const memberId = (tag && existingIds.has(tag) ? tag : null) ?? events.flatMap((e) => e.recipients).map((a) => idByAddress.get(a)).find(Boolean);
    if (memberId) result.set(emailId, memberId);
  }
  return result;
}

/**
 * Rebuilds the timeline rows of these emails from Bronze: their old rows go, and the rows their events say now
 * are written, in as few statements as the volume allows. Emails whose recipient is no member get no rows.
 * Returns how many rows were written.
 */
export async function projectEmails(repos: Pick<Repos, "members" | "resendEvents" | "activities">, emailIds: string[]): Promise<number> {
  const unique = [...new Set(emailIds)];
  if (unique.length === 0) return 0;
  const events = await repos.resendEvents.eventsForEmails(unique);
  const byEmail = new Map<string, ResendEvent[]>();
  for (const event of events) byEmail.set(event.email_id, [...(byEmail.get(event.email_id) ?? []), event]);

  const members = await membersForEmails(repos, byEmail);
  const rows: NewActivity[] = [];
  for (const [emailId, memberId] of members) {
    for (const row of emailActivities(byEmail.get(emailId) ?? [])) rows.push({ ...row, memberId });
  }

  await repos.activities.removeForMany(EMAIL_ACTIVITY_SOURCE, unique);
  let written = 0;
  for (const part of chunk(rows, INSERT_CHUNK)) written += await repos.activities.recordMany(part);
  return written;
}
