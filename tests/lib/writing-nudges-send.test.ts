import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

// End-to-end through the real senders with Supabase, Slack and the calendar loader faked: what
// matters here is how many DMs go out, not what the queries look like.
const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
vi.mock("@/lib/slack", () => ({ sendSlackDM: (p: any) => sendSlackDM(p) }));

// Slack user id = "U-" + member id for every member in members.
vi.mock("@/lib/slack-matching", () => ({
  matchSlackUsersToMembers: (_slack: unknown, members: { id: string }[]) =>
    new Map(members.map((m) => [`U-${m.id}`, m.id])),
}));

const calendarPrickleIds = vi.fn(async (_supabase: unknown, _memberId: string): Promise<Set<string>> => new Set());
vi.mock("@/lib/calendar-feed", () => ({
  loadCalendarFeedPrickleIds: (supabase: unknown, memberId: string) => calendarPrickleIds(supabase, memberId),
}));

vi.mock("@/lib/cron-heartbeats", () => ({ withCronHeartbeat: async (_job: string, res: Response) => res }));

let fake: FakeSupabase;
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake }));

const { POST } = await import("@/app/api/internal/nudges/pre-prickle/route");
const { sendPostPricklePrompts, tryRecordNudge } = await import("@/lib/writing-nudges");

const goalRow = (id: string, memberId: string, projectId: string, measure: string, title = "Novel") => ({
  id,
  member_id: memberId,
  project_id: projectId,
  measure,
  writing_projects: { title, archived_at: null },
});

/** writing_nudge_log that behaves like its UNIQUE (prickle_id, member_id, kind) constraint. */
function nudgeLog() {
  const seen = new Set<string>();
  return (query: { calls: { method: string; args: unknown[] }[] }) => {
    const insert = query.calls.find((c) => c.method === "insert");
    const row = insert?.args[0] as { prickle_id: string; member_id: string; kind: string };
    const key = `${row.prickle_id}:${row.member_id}:${row.kind}`;
    if (seen.has(key)) return { data: null, error: { code: "23505" } };
    seen.add(key);
    return { data: [{ id: key }] };
  };
}

const PRICKLE = {
  id: "p1",
  type_id: "t1",
  host: "host",
  start_time: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  prickle_types: { name: "Progress Prickle", purpose: "writing" },
};

function cronRequest() {
  return new NextRequest("http://localhost/api/internal/nudges/pre-prickle", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  sendSlackDM.mockClear();
  calendarPrickleIds.mockReset();
  calendarPrickleIds.mockResolvedValue(new Set());
  process.env.CRON_INTERNAL_SECRET = "test-secret";
});

describe("pre-prickle nudge route", () => {
  function setup(goals: object[], extra: FakeTables = {}) {
    fake = createFakeSupabase({
      writing_goals: { data: goals },
      prickles: { data: [PRICKLE] },
      members: { data: [{ id: "m1" }, { id: "m2" }] },
      writing_nudge_log: nudgeLog(),
      ...extra,
    });
  }

  it("sends one DM to a member with several goals that all match the same prickle", async () => {
    setup([
      goalRow("g1", "m1", "proj1", "words"),
      goalRow("g2", "m1", "proj2", "chapters"),
      goalRow("g3", "m1", "proj3", "prickles"),
    ]);
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));

    const res = await POST(cronRequest());

    expect(await res.json()).toEqual({ sent: 1 });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
    expect(sendSlackDM.mock.calls[0][0].slackUserId).toBe("U-m1");
  });

  it("doesn't nudge the same member for the same prickle again on the next tick", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));

    await POST(cronRequest());
    const second = await POST(cronRequest());

    expect(await second.json()).toEqual({ sent: 0 });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("nudges a word-count goal only for prickles on that member's calendar", async () => {
    setup([goalRow("g1", "m1", "proj1", "words"), goalRow("g2", "m2", "proj2", "words")]);
    calendarPrickleIds.mockImplementation(async (_s, memberId) => new Set(memberId === "m2" ? ["p1"] : []));

    await POST(cronRequest());

    expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
  });

  it("rejects a request without the cron secret", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);
    const res = await POST(new NextRequest("http://localhost/api/internal/nudges/pre-prickle", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });
});

describe("sendPostPricklePrompts", () => {
  function setup(goals: object[]) {
    fake = createFakeSupabase({
      prickles: { data: [{ id: "p1", prickle_types: { name: "Progress Prickle" } }] },
      // m1 left and rejoined: two attendance rows, still one prompt.
      prickle_attendance: { data: [{ member_id: "m1" }, { member_id: "m1" }] },
      writing_goals: { data: goals },
      members: { data: [{ id: "m1" }, { id: "m2" }] },
      writing_nudge_log: nudgeLog(),
    });
  }

  it("sends an attendee one DM with a dropdown per goal, in each goal's measure", async () => {
    setup([
      goalRow("g1", "m1", "proj1", "words", "Novel"),
      goalRow("g2", "m1", "proj2", "scenes", "Memoir"),
      goalRow("g3", "m1", "proj1", "words", "Novel"), // same project + measure: asked once
      goalRow("g4", "m2", "proj4", "words"), // didn't attend
    ]);

    expect(await sendPostPricklePrompts(fake, "p1")).toBe(1);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
    const { slackUserId, blocks } = sendSlackDM.mock.calls[0][0];
    expect(slackUserId).toBe("U-m1");
    expect(blocks!.map((b: any) => b.block_id)).toEqual(["quick_log:proj1:words", "quick_log:proj2:scenes"]);
  });

  it("doesn't prompt the same attendee twice for one prickle", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);

    await sendPostPricklePrompts(fake, "p1");
    expect(await sendPostPricklePrompts(fake, "p1")).toBe(0);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });
});

describe("tryRecordNudge", () => {
  it("is true only for the first record of a (prickle, member, kind)", async () => {
    fake = createFakeSupabase({ writing_nudge_log: nudgeLog() });
    expect(await tryRecordNudge(fake, "p1", "m1", "pre_prickle_nudge")).toBe(true);
    expect(await tryRecordNudge(fake, "p1", "m1", "pre_prickle_nudge")).toBe(false);
    expect(await tryRecordNudge(fake, "p1", "m1", "post_prickle_prompt")).toBe(true);
    expect(await tryRecordNudge(fake, "p1", "m2", "pre_prickle_nudge")).toBe(true);
  });
});
