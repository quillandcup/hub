import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { ResendEvent } from "@/lib/data/resend";
import {
  EMAIL_ACTIVITY_SOURCE,
  emailActivities,
  projectEmails,
  resendEmailUrl,
  stripLinkSecrets,
  toResendEvent,
  verifyResendSignature,
} from "@/lib/email-events";

const SECRET_KEY = Buffer.from("test-signing-key-for-resend-webhooks");
const SECRET = `whsec_${SECRET_KEY.toString("base64")}`;
const NOW = 1_800_000_000;

const sign = (body: string, id = "msg_1", timestamp = String(NOW), key = SECRET_KEY) =>
  `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
const headers = (body: string, over: Partial<{ id: string | null; timestamp: string | null; signature: string | null }> = {}) => ({
  id: "msg_1",
  timestamp: String(NOW),
  signature: sign(body),
  ...over,
});

describe("verifyResendSignature", () => {
  const body = '{"type":"email.sent"}';

  afterEach(() => vi.unstubAllEnvs());

  it("accepts a body signed with the secret", () => {
    expect(verifyResendSignature(body, headers(body), SECRET, NOW)).toEqual({ valid: true });
  });

  it("accepts a secret without the whsec_ prefix", () => {
    expect(verifyResendSignature(body, headers(body), SECRET_KEY.toString("base64"), NOW)).toEqual({ valid: true });
  });

  it("accepts any of several signatures, as while a secret is rotated", () => {
    const signature = `${sign(body, "msg_1", String(NOW), Buffer.from("old-key"))} ${sign(body)}`;
    expect(verifyResendSignature(body, headers(body, { signature }), SECRET, NOW)).toEqual({ valid: true });
  });

  it("rejects a changed body, another secret, another id and a signature of another version", () => {
    expect(verifyResendSignature(`${body} `, headers(body), SECRET, NOW)).toEqual({ valid: false, reason: "mismatch" });
    expect(verifyResendSignature(body, headers(body, { signature: sign(body, "msg_1", String(NOW), Buffer.from("other")) }), SECRET, NOW)).toEqual({
      valid: false,
      reason: "mismatch",
    });
    expect(verifyResendSignature(body, headers(body, { id: "msg_2" }), SECRET, NOW)).toEqual({ valid: false, reason: "mismatch" });
    expect(verifyResendSignature(body, headers(body, { signature: sign(body).replace("v1,", "v2,") }), SECRET, NOW)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects missing headers and a timestamp more than five minutes away, either side", () => {
    expect(verifyResendSignature(body, headers(body, { id: null }), SECRET, NOW)).toEqual({ valid: false, reason: "missing" });
    expect(verifyResendSignature(body, headers(body, { signature: null }), SECRET, NOW)).toEqual({ valid: false, reason: "missing" });
    const old = String(NOW - 301);
    expect(verifyResendSignature(body, headers(body, { timestamp: old, signature: sign(body, "msg_1", old) }), SECRET, NOW)).toEqual({
      valid: false,
      reason: "too_old",
    });
    const future = String(NOW + 301);
    expect(verifyResendSignature(body, headers(body, { timestamp: future, signature: sign(body, "msg_1", future) }), SECRET, NOW).valid).toBe(false);
    expect(verifyResendSignature(body, headers(body, { timestamp: "soon" }), SECRET, NOW)).toEqual({ valid: false, reason: "too_old" });
  });

  it("skips the check without a secret locally, and rejects everything on a deployed build", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyResendSignature(body, headers(body, { signature: null }), undefined, NOW)).toEqual({ valid: true });
    vi.stubEnv("NODE_ENV", "production");
    expect(verifyResendSignature(body, headers(body), undefined, NOW)).toEqual({ valid: false, reason: "not_configured" });
  });
});

describe("stripLinkSecrets", () => {
  it("keeps the origin and path and drops the query string and fragment", () => {
    expect(stripLinkSecrets("https://hub.example.com/auth/confirm?token_hash=secret&type=magiclink#frag")).toBe("https://hub.example.com/auth/confirm");
  });

  it("cuts a value that is not a URL at the first ? or #", () => {
    expect(stripLinkSecrets("not a url?token=1")).toBe("not a url");
  });
});

const payload = (type: string, data: Record<string, unknown> = {}, createdAt = "2097-01-01T10:00:05.000Z") => ({
  type,
  created_at: createdAt,
  data: {
    email_id: "em_1",
    from: "Hub <hub@example.com>",
    to: ["Ada@Example.com"],
    subject: "Ready for Writing?",
    tags: { kind: "prickle_checkin", member: "mbr_AAAAAAAAAAA1" },
    ...data,
  },
});

describe("toResendEvent", () => {
  it("maps a sent event, lower-casing the recipient", () => {
    expect(toResendEvent(payload("email.sent"), "msg_1")).toMatchObject({
      event_id: "msg_1",
      event_type: "email.sent",
      email_id: "em_1",
      occurred_at: "2097-01-01T10:00:05.000Z",
      recipients: ["ada@example.com"],
      from_address: "Hub <hub@example.com>",
      subject: "Ready for Writing?",
      tags: { kind: "prickle_checkin", member: "mbr_AAAAAAAAAAA1" },
      link: null,
      bounce_type: null,
    });
  });

  it("reads the address out of a 'Name <address>' recipient, and tags sent as a list", () => {
    const event = toResendEvent(payload("email.sent", { to: "Ada <Ada@Example.com>", tags: [{ name: "kind", value: "welcome" }] }), "msg_1");
    expect(event?.recipients).toEqual(["ada@example.com"]);
    expect(event?.tags).toEqual({ kind: "welcome" });
  });

  it("reads recipients quickly and sensibly whatever the text, including piles of angle brackets", () => {
    const hostile = `${"<=".repeat(50_000)}`;
    const started = Date.now();
    const event = toResendEvent(payload("email.sent", { to: [hostile, "<>", "Bo <Bo@Example.com>"] }), "msg_6");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(event?.recipients).toEqual([hostile, "<>", "bo@example.com"]);
  });

  it("takes a click's own timestamp, and keeps the link without its query string anywhere, the raw payload included", () => {
    const click = { link: "https://hub.example.com/login?token=secret#x", timestamp: "2097-01-01T11:00:00.000Z", ipAddress: "1.2.3.4" };
    const event = toResendEvent(payload("email.clicked", { click }), "msg_2");
    expect(event?.occurred_at).toBe("2097-01-01T11:00:00.000Z");
    expect(event?.link).toBe("https://hub.example.com/login");
    expect(JSON.stringify(event?.raw_payload)).not.toContain("secret");
  });

  it("keeps a bounce's type and message", () => {
    const event = toResendEvent(payload("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: "Mailbox does not exist" } }), "msg_3");
    expect(event).toMatchObject({ bounce_type: "Permanent", detail: "Mailbox does not exist" });
  });

  it("keeps a failure's reason", () => {
    expect(toResendEvent(payload("email.failed", { failed: { reason: "Invalid recipient" } }), "msg_4")?.detail).toBe("Invalid recipient");
  });

  it("ignores event types it does not keep, and payloads without what a row needs", () => {
    expect(toResendEvent(payload("email.received"), "msg_5")).toBeNull();
    expect(toResendEvent(payload("domain.updated"), "msg_5")).toBeNull();
    expect(toResendEvent({ type: "email.sent", created_at: "2097-01-01T00:00:00Z", data: {} }, "msg_5")).toBeNull();
    expect(toResendEvent({ type: "email.sent", created_at: "yesterday", data: { email_id: "em_1" } }, "msg_5")).toBeNull();
    expect(toResendEvent(null, "msg_5")).toBeNull();
    expect(toResendEvent("email.sent", "msg_5")).toBeNull();
  });
});

const ev = (type: string, at: string, extra: Partial<ResendEvent> = {}): ResendEvent => ({
  id: `rsev_${type}${at}`,
  event_id: `${type}-${at}`,
  event_type: type,
  email_id: "em_1",
  occurred_at: at,
  recipients: ["ada@example.com"],
  from_address: "Hub <hub@example.com>",
  subject: "Ready for Writing?",
  tags: { kind: "prickle_checkin" },
  link: null,
  bounce_type: null,
  detail: null,
  ...extra,
});

describe("emailActivities", () => {
  it("makes a sent row that records when it was delivered, and no row of its own for delivery", () => {
    const rows = emailActivities([ev("email.sent", "2097-01-01T10:00:00Z"), ev("email.delivered", "2097-01-01T10:00:03Z")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "email_sent",
      title: "Email sent: Ready for Writing?",
      description: "From Hub <hub@example.com>",
      occurredAt: "2097-01-01T10:00:00Z",
      source: EMAIL_ACTIVITY_SOURCE,
      relatedId: "em_1",
      engagementValue: 0,
      actorKind: "system",
      category: "communication",
    });
    expect(rows[0].data).toMatchObject({ email_id: "em_1", kind: "prickle_checkin", delivered_at: "2097-01-01T10:00:03Z", resend_url: resendEmailUrl("em_1") });
  });

  it("collapses opens into one row at the first, with the count", () => {
    const rows = emailActivities([
      ev("email.sent", "2097-01-01T10:00:00Z"),
      ev("email.opened", "2097-01-01T10:05:00Z"),
      ev("email.opened", "2097-01-01T12:00:00Z"),
      ev("email.opened", "2097-01-02T09:00:00Z"),
    ]);
    const opened = rows.filter((r) => r.type === "email_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ occurredAt: "2097-01-01T10:05:00Z", description: "Opened 3 times" });
    expect(opened[0].data).toMatchObject({ open_count: 3, last_opened_at: "2097-01-02T09:00:00Z" });
  });

  it("makes a row for every click, showing the link", () => {
    const rows = emailActivities([
      ev("email.sent", "2097-01-01T10:00:00Z"),
      ev("email.clicked", "2097-01-01T10:06:00Z", { link: "https://hub.example.com/a" }),
      ev("email.clicked", "2097-01-01T10:07:00Z", { link: "https://hub.example.com/b" }),
    ]);
    expect(rows.filter((r) => r.type === "email_clicked").map((r) => r.description)).toEqual(["https://hub.example.com/a", "https://hub.example.com/b"]);
  });

  it("makes rows for a bounce, a complaint and a failure, each saying why", () => {
    const rows = emailActivities([
      ev("email.sent", "2097-01-01T10:00:00Z"),
      ev("email.bounced", "2097-01-01T10:01:00Z", { bounce_type: "Permanent", detail: "Mailbox does not exist" }),
      ev("email.complained", "2097-01-01T10:02:00Z"),
      ev("email.failed", "2097-01-01T10:03:00Z", { detail: "Invalid recipient" }),
      ev("email.delivery_delayed", "2097-01-01T10:04:00Z"),
    ]);
    expect(rows.find((r) => r.type === "email_bounced")).toMatchObject({ title: "Bounced: Ready for Writing?", description: "Permanent: Mailbox does not exist" });
    expect(rows.find((r) => r.type === "email_complained")?.title).toBe("Marked as spam: Ready for Writing?");
    const failed = rows.filter((r) => r.type === "email_failed");
    expect(failed.map((r) => r.title)).toEqual(["Not delivered: Ready for Writing?", "Delayed: Ready for Writing?"]);
    expect(failed[0].description).toBe("Invalid recipient");
  });

  it("builds the sent row from the first event when the sent event itself was missed, and handles no subject and no events", () => {
    const rows = emailActivities([ev("email.delivered", "2097-01-01T10:00:03Z", { subject: null })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "email_sent", title: "Email sent: (no subject)", occurredAt: "2097-01-01T10:00:03Z" });
    expect(emailActivities([])).toEqual([]);
  });

  it("marks the kind as null for an email without a tag, as Supabase's sign-in emails are", () => {
    const rows = emailActivities([ev("email.sent", "2097-01-01T10:00:00Z", { tags: {} })]);
    expect(rows[0].data).toMatchObject({ kind: null });
  });
});

describe("projectEmails", () => {
  const ADA = "mbr_AAAAAAAAAAA1";
  const BO = "mbr_AAAAAAAAAAA2";
  const setup = () => {
    const dataset = new InMemoryDataset({
      members: [
        { id: ADA, name: "Ada Example", email: "ada@example.com" },
        { id: BO, name: "Bo Example", email: "bo@example.com" },
      ],
    });
    return { dataset, repos: createInMemoryRepos(dataset) };
  };
  const event = (emailId: string, type: string, at: string, extra: Record<string, unknown> = {}) => ({
    event_id: `${emailId}-${type}-${at}`,
    event_type: type,
    email_id: emailId,
    occurred_at: at,
    recipients: ["ada@example.com"],
    subject: "Ready for Writing?",
    raw_payload: {},
    ...extra,
  });
  const rowsOf = (dataset: InMemoryDataset) => dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE);

  it("writes an email's timeline rows to the member it went to", async () => {
    const { dataset, repos } = setup();
    await repos.resendEvents.record([event("em_1", "email.sent", "2097-01-01T10:00:00Z"), event("em_1", "email.opened", "2097-01-01T10:05:00Z")]);

    expect(await projectEmails(repos, ["em_1"])).toBe(2);
    expect(rowsOf(dataset).map((a) => [a.member_id, a.activity_type, a.related_id])).toEqual([
      [ADA, "email_sent", "em_1"],
      [ADA, "email_opened", "em_1"],
    ]);
  });

  it("prefers the member tag over the address, and ignores a tag naming no member", async () => {
    const { dataset, repos } = setup();
    await repos.resendEvents.record([
      event("em_tagged", "email.sent", "2097-01-01T10:00:00Z", { tags: { member: BO } }),
      event("em_stale", "email.sent", "2097-01-01T10:00:00Z", { tags: { member: "mbr_ZZZZZZZZZZZ9" } }),
    ]);
    await projectEmails(repos, ["em_tagged", "em_stale"]);
    expect(rowsOf(dataset).map((a) => [a.related_id, a.member_id]).sort()).toEqual([
      ["em_stale", ADA],
      ["em_tagged", BO],
    ]);
  });

  it("writes nothing for an email nobody matches, and keeps its events for a later run", async () => {
    const { dataset, repos } = setup();
    await repos.resendEvents.record([event("em_x", "email.sent", "2097-01-01T10:00:00Z", { recipients: ["stranger@example.com"] })]);
    expect(await projectEmails(repos, ["em_x"])).toBe(0);
    expect(rowsOf(dataset)).toEqual([]);
    expect(await repos.resendEvents.eventsForEmails(["em_x"])).toHaveLength(1);
  });

  it("rebuilds rather than adds: projecting again changes nothing, and a new event updates the rows", async () => {
    const { dataset, repos } = setup();
    await repos.resendEvents.record([event("em_1", "email.sent", "2097-01-01T10:00:00Z")]);
    await projectEmails(repos, ["em_1"]);
    await projectEmails(repos, ["em_1"]);
    expect(rowsOf(dataset)).toHaveLength(1);

    await repos.resendEvents.record([event("em_1", "email.clicked", "2097-01-01T10:06:00Z", { link: "https://hub.example.com/a" })]);
    await projectEmails(repos, ["em_1"]);
    expect(rowsOf(dataset).map((a) => a.activity_type)).toEqual(["email_sent", "email_clicked"]);
  });

  it("moves an email's rows to the right member when the match changes, and leaves other sources and emails alone", async () => {
    const { dataset, repos } = setup();
    await repos.activities.record({ memberId: ADA, type: "slack_message", category: "communication", title: "Posted", occurredAt: "2097-01-01T00:00:00Z", source: "slack", relatedId: "em_1" });
    await repos.resendEvents.record([event("em_1", "email.sent", "2097-01-01T10:00:00Z"), event("em_2", "email.sent", "2097-01-01T10:00:00Z", { recipients: ["bo@example.com"] })]);
    await projectEmails(repos, ["em_1", "em_2"]);

    dataset.resendEvents.find((e) => e.email_id === "em_1")!.tags = { member: BO };
    await projectEmails(repos, ["em_1"]);

    expect(rowsOf(dataset).map((a) => [a.related_id, a.member_id]).sort()).toEqual([
      ["em_1", BO],
      ["em_2", BO],
    ]);
    expect(dataset.activities.filter((a) => a.source === "slack")).toHaveLength(1);
  });

  it("does nothing for no emails", async () => {
    const { repos } = setup();
    expect(await projectEmails(repos, [])).toBe(0);
  });
});
