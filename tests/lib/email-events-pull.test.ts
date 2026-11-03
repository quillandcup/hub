import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { EMAIL_ACTIVITY_SOURCE } from "@/lib/email-events";
import { listEmailsSince, parseResendTime, pullEmailEvents, recoveredEvents, type ListedEmail } from "@/lib/email-events-pull";
import { useFakeClock } from "@/tests/helpers/fake-clock";

describe("with a fixed clock", () => {
  useFakeClock(() => Date.parse("2097-01-10T00:00:00Z"));

const email = (id: string, createdAt: string, over: Partial<ListedEmail> = {}): ListedEmail => ({
  id,
  to: ["Ada@Example.com"],
  from: "Hub <hub@example.com>",
  subject: "Ready for Writing?",
  created_at: createdAt,
  last_event: "delivered",
  ...over,
});

const page = (data: ListedEmail[], hasMore: boolean) => new Response(JSON.stringify({ object: "list", has_more: hasMore, data }), { status: 200 });

describe("parseResendTime", () => {
  it("reads Resend's database format and ISO, and gives null for nonsense", () => {
    expect(parseResendTime("2097-01-05 22:13:42.674981+00")).toBe("2097-01-05T22:13:42.674Z");
    expect(parseResendTime("2097-01-05T22:13:42.000Z")).toBe("2097-01-05T22:13:42.000Z");
    expect(parseResendTime("later")).toBeNull();
  });
});

describe("listEmailsSince", () => {
  it("follows the cursor and stops at the first email older than the window", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([email("em_3", "2097-01-09T10:00:00Z"), email("em_2", "2097-01-08 10:00:00+00")], true))
      .mockResolvedValueOnce(page([email("em_1", "2097-01-07T10:00:00Z"), email("em_0", "2097-01-01T10:00:00Z")], true));

    const emails = await listEmailsSince("re_key", "2097-01-07T00:00:00Z", fetchMock);

    expect(emails.map((e) => e.id)).toEqual(["em_3", "em_2", "em_1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = fetchMock.mock.calls[1][0] as URL;
    expect(second.searchParams.get("after")).toBe("em_2");
    expect(second.searchParams.get("limit")).toBe("100");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "Bearer re_key" });
  });

  it("stops when there are no more pages, and on an empty page", async () => {
    expect(await listEmailsSince("k", "2097-01-01T00:00:00Z", vi.fn().mockResolvedValue(page([email("em_1", "2097-01-09T10:00:00Z")], false)))).toHaveLength(1);
    expect(await listEmailsSince("k", "2097-01-01T00:00:00Z", vi.fn().mockResolvedValue(page([], true)))).toEqual([]);
  });

  it("retries a rate limit after the pause Resend names, then gives up after three tries", async () => {
    const limited = () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
    const ok = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(page([email("em_1", "2097-01-09T10:00:00Z")], false));
    expect(await listEmailsSince("k", "2097-01-01T00:00:00Z", ok)).toHaveLength(1);
    expect(ok).toHaveBeenCalledTimes(2);

    const always = vi.fn().mockImplementation(async () => limited());
    await expect(listEmailsSince("k", "2097-01-01T00:00:00Z", always)).rejects.toThrow("429");
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("fails with Resend's answer when the key cannot list emails", async () => {
    const forbidden = vi.fn().mockResolvedValue(new Response('{"name":"restricted_api_key"}', { status: 401 }));
    await expect(listEmailsSince("k", "2097-01-01T00:00:00Z", forbidden)).rejects.toThrow(/401.*restricted_api_key/);
  });
});

describe("recoveredEvents", () => {
  it("recovers 'sent' and the final state, timed at the send, and says so", () => {
    const events = recoveredEvents(email("em_1", "2097-01-09T10:00:00Z", { last_event: "bounced" }), new Set());
    expect(events.map((e) => [e.event_id, e.event_type, e.occurred_at])).toEqual([
      ["pull:em_1:email.sent", "email.sent", "2097-01-09T10:00:00.000Z"],
      ["pull:em_1:email.bounced", "email.bounced", "2097-01-09T10:00:00.000Z"],
    ]);
    expect(events[0].recipients).toEqual(["ada@example.com"]);
    expect(events[1].detail).toMatch(/Recovered/);
  });

  it("recovers only what Bronze lacks", () => {
    const e = email("em_1", "2097-01-09T10:00:00Z");
    expect(recoveredEvents(e, new Set(["email.sent"])).map((x) => x.event_type)).toEqual(["email.delivered"]);
    expect(recoveredEvents(e, new Set(["email.sent", "email.delivered"]))).toEqual([]);
  });

  it("does not invent an open or a click, and skips an email with no usable time", () => {
    expect(recoveredEvents(email("em_1", "2097-01-09T10:00:00Z", { last_event: "opened" }), new Set()).map((x) => x.event_type)).toEqual(["email.sent"]);
    expect(recoveredEvents(email("em_1", "2097-01-09T10:00:00Z", { last_event: "clicked" }), new Set()).map((x) => x.event_type)).toEqual(["email.sent"]);
    expect(recoveredEvents(email("em_1", "never"), new Set())).toEqual([]);
    expect(recoveredEvents(email("em_1", "2097-01-09T10:00:00Z", { last_event: null, to: null }), new Set())[0].recipients).toEqual([]);
  });
});

describe("pullEmailEvents", () => {
  const ADA = "mbr_AAAAAAAAAAA1";
  const setup = () => {
    const dataset = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example", email: "ada@example.com" }] });
    return { dataset, repos: createInMemoryRepos(dataset) };
  };

  it("fills in what the webhook missed and puts the emails on the member's timeline", async () => {
    const { dataset, repos } = setup();
    const fetchMock = vi.fn().mockResolvedValue(page([email("em_1", "2097-01-09T10:00:00Z")], false));

    const result = await pullEmailEvents(repos, "re_key", "2097-01-07T00:00:00Z", fetchMock);

    expect(result).toEqual({ listed: 1, recovered: 2, projected: 1 });
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE).map((a) => [a.member_id, a.activity_type])).toEqual([[ADA, "email_sent"]]);
  });

  it("is idempotent: a second pull writes no new events and the same rows", async () => {
    const { dataset, repos } = setup();
    const fetchMock = vi.fn().mockImplementation(async () => page([email("em_1", "2097-01-09T10:00:00Z")], false));

    await pullEmailEvents(repos, "re_key", "2097-01-07T00:00:00Z", fetchMock);
    const second = await pullEmailEvents(repos, "re_key", "2097-01-07T00:00:00Z", fetchMock);

    expect(second.recovered).toBe(0);
    expect(dataset.resendEvents).toHaveLength(2);
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE)).toHaveLength(1);
  });

  it("keeps the webhook's own events instead of recovering them, and its open", async () => {
    const { dataset, repos } = setup();
    await repos.resendEvents.record([
      { event_id: "svix_1", event_type: "email.sent", email_id: "em_1", occurred_at: "2097-01-09T10:00:01Z", recipients: ["ada@example.com"], raw_payload: {} },
      { event_id: "svix_2", event_type: "email.delivered", email_id: "em_1", occurred_at: "2097-01-09T10:00:03Z", recipients: ["ada@example.com"], raw_payload: {} },
      { event_id: "svix_3", event_type: "email.opened", email_id: "em_1", occurred_at: "2097-01-09T11:00:00Z", recipients: ["ada@example.com"], raw_payload: {} },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(page([email("em_1", "2097-01-09T10:00:00Z", { last_event: "opened" })], false));

    const result = await pullEmailEvents(repos, "re_key", "2097-01-07T00:00:00Z", fetchMock);

    expect(result.recovered).toBe(0);
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE).map((a) => a.activity_type)).toEqual(["email_sent", "email_opened"]);
  });

  it("handles more emails than one chunk", async () => {
    const { dataset, repos } = setup();
    const many = Array.from({ length: 450 }, (_, i) => email(`em_${i}`, "2097-01-09T10:00:00Z"));
    const fetchMock = vi.fn().mockResolvedValue(page(many, false));

    const result = await pullEmailEvents(repos, "re_key", "2097-01-07T00:00:00Z", fetchMock);

    expect(result).toMatchObject({ listed: 450, recovered: 900, projected: 450 });
    expect(dataset.activities.filter((a) => a.source === EMAIL_ACTIVITY_SOURCE)).toHaveLength(450);
  });
});
});
