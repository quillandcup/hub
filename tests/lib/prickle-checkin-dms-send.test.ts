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

const { POST } = await import("@/app/api/internal/prickle-checkins/route");
const { getActiveGoalCandidates, sendCheckoutDMs, sendTestCheckinDM, tryRecordCheckinDM } = await import(
  "@/lib/prickle-checkin-dms"
);

const goalRow = (id: string, memberId: string, projectId: string, measure: string, title = "Novel") => ({
  id,
  member_id: memberId,
  project_id: projectId,
  measure,
  writing_projects: { title, archived_at: null },
});

/**
 * prickle_checkin_dm_log that behaves like its UNIQUE (prickle_id, member_id, kind) constraint;
 * a select returns the rows logged so far, filtered by `kind`.
 */
function dmLog() {
  const rows = new Map<string, { id: string; prickle_id: string; member_id: string; kind: string }>();
  return (query: { calls: { method: string; args: unknown[] }[] }) => {
    const insert = query.calls.find((c) => c.method === "insert");
    if (!insert) {
      const kind = query.calls.find((c) => c.method === "eq" && c.args[0] === "kind")?.args[1];
      return { data: [...rows.values()].filter((r) => !kind || r.kind === kind) };
    }
    const row = insert.args[0] as { prickle_id: string; member_id: string; kind: string };
    const key = `${row.prickle_id}:${row.member_id}:${row.kind}`;
    if (rows.has(key)) return { data: null, error: { code: "23505" } };
    rows.set(key, { id: key, ...row });
    return { data: [{ id: key }] };
  };
}

const PRICKLE = {
  id: "p1",
  type_id: "t1",
  host: "host",
  start_time: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  end_time: new Date(Date.now() + 80 * 60 * 1000).toISOString(),
  prickle_types: { name: "Progress Prickle", purpose: "writing" },
};

function cronRequest() {
  return new NextRequest("http://localhost/api/internal/prickle-checkins", {
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

describe("prickle check-in route", () => {
  function setup(goals: object[], extra: FakeTables = {}) {
    fake = createFakeSupabase({
      writing_goals: { data: goals },
      prickles: { data: [PRICKLE] },
      members: { data: [{ id: "m1" }, { id: "m2" }] },
      prickle_checkin_dm_log: dmLog(),
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

    expect(await res.json()).toEqual({ checkins: 1, checkouts: 0 });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
    expect(sendSlackDM.mock.calls[0][0].slackUserId).toBe("U-m1");
  });

  it("skips a member who already answered every check-in question", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      prickle_checkins: { data: [{ id: "c1", member_id: "m1", prickle_id: "p1", feelings_before: ["tired"], need: "company", session_rating: null, feelings_after: [] }] },
    });
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));

    expect(await (await POST(cronRequest())).json()).toEqual({ checkins: 0, checkouts: 0 });
    expect(sendSlackDM).not.toHaveBeenCalled();
    // Not logged as sent, so clearing an answer before the window closes still gets the DM.
    expect(fake.queries.some((q) => q.table === "prickle_checkin_dm_log" && q.calls.some((c) => c.method === "insert"))).toBe(false);
  });

  it("asks the check-in questions, starting from answers already saved", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      prickle_checkins: { data: [{ id: "c1", member_id: "m1", prickle_id: "p1", feelings_before: [], need: "company", session_rating: null, feelings_after: [] }] },
    });
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));

    await POST(cronRequest());

    const [feelings, need] = sendSlackDM.mock.calls[0][0].blocks!;
    expect(feelings.block_id).toBe("prickle_checkin:p1:feelings_before");
    expect(feelings.accessory.initial_options).toBeUndefined();
    expect(need.block_id).toBe("prickle_checkin:p1:need");
    expect(need.accessory.initial_option.value).toBe("company");
  });

  it("skips a member who turned check-ins off, without logging it", async () => {
    setup([goalRow("g1", "m1", "proj1", "words"), goalRow("g2", "m2", "proj2", "words")], {
      notification_preferences: { data: [{ member_id: "m1", kind: "prickle_checkin", channel: "slack", enabled: false }] },
    });
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));

    expect(await (await POST(cronRequest())).json()).toEqual({ checkins: 1, checkouts: 0 });
    expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
  });

  it("doesn't count a check-in whose Slack send failed as sent", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await (await POST(cronRequest())).json()).toEqual({ checkins: 0, checkouts: 0 });
  });

  it("doesn't check in with the same member for the same prickle again on the next tick", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);
    calendarPrickleIds.mockResolvedValue(new Set(["p1"]));

    await POST(cronRequest());
    const second = await POST(cronRequest());

    expect(await second.json()).toEqual({ checkins: 0, checkouts: 0 });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("checks in on a word-count goal only for prickles on that member's calendar", async () => {
    setup([goalRow("g1", "m1", "proj1", "words"), goalRow("g2", "m2", "proj2", "words")]);
    calendarPrickleIds.mockImplementation(async (_s, memberId) => new Set(memberId === "m2" ? ["p1"] : []));

    await POST(cronRequest());

    expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
  });

  it("sends check-outs for a recent prickle once its attendance has been imported", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      prickle_attendance: { data: [{ id: "a1", member_id: "m1", prickle_id: "p1" }] },
    });

    expect(await (await POST(cronRequest())).json()).toEqual({ checkins: 0, checkouts: 1 });
    expect(sendSlackDM.mock.calls[0][0].text).toBe("Checking out of Progress Prickle: how did it go?");
    // Later ticks see the log row and leave it alone.
    expect(await (await POST(cronRequest())).json()).toEqual({ checkins: 0, checkouts: 0 });
  });

  it("rejects a request without the cron secret", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);
    const res = await POST(new NextRequest("http://localhost/api/internal/prickle-checkins", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });
});

describe("sendCheckoutDMs", () => {
  const checkout = async () =>
    sendCheckoutDMs(
      fake,
      [{ id: "p1", typeName: "Progress Prickle", startTime: "2026-10-05T11:00:00.000Z", endTime: "2026-10-05T12:00:00.000Z" }],
      await getActiveGoalCandidates(fake),
      new Date("2026-10-05T12:10:00.000Z").getTime()
    );

  function setup(goals: object[], extra: FakeTables = {}) {
    fake = createFakeSupabase({
      // m1 left and rejoined: two attendance rows, still one check-out.
      prickle_attendance: {
        data: [
          { id: "a1", member_id: "m1", prickle_id: "p1" },
          { id: "a2", member_id: "m1", prickle_id: "p1" },
        ],
      },
      writing_goals: { data: goals },
      members: { data: [{ id: "m1" }, { id: "m2" }] },
      prickle_checkin_dm_log: dmLog(),
      ...extra,
    });
  }

  it("sends an attendee one DM with a number question per project, in its goal's measure", async () => {
    setup([
      goalRow("g1", "m1", "proj1", "words", "Novel"),
      goalRow("g2", "m1", "proj2", "scenes", "Memoir"),
      goalRow("g3", "m1", "proj1", "words", "Novel"), // same project: asked once
      goalRow("g4", "m2", "proj4", "words"), // didn't attend
    ]);

    expect(await checkout()).toBe(1);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
    const { slackUserId, blocks } = sendSlackDM.mock.calls[0][0];
    expect(slackUserId).toBe("U-m1");
    expect(blocks!.map((b: any) => b.block_id)).toEqual([
      undefined, // rating question
      "prickle_checkin:p1:session_rating",
      "prickle_checkin:p1:feelings_after",
      "quick_log:p1:proj1:words",
      "quick_log:p1:proj2:scenes",
      undefined, // footer
    ]);
    expect(blocks!.at(-1).elements.at(-1).text).toContain("/settings/notifications|Notification settings");
  });

  it("skips an attendee who turned check-outs off, without logging it", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      notification_preferences: { data: [{ member_id: "m1", kind: "prickle_checkout", channel: "slack", enabled: false }] },
    });

    expect(await checkout()).toBe(0);
    expect(sendSlackDM).not.toHaveBeenCalled();
    // Turning them back on before the lookback ends still sends one.
    expect(fake.queries.some((q) => q.table === "prickle_checkin_dm_log" && q.calls.some((c) => c.method === "insert"))).toBe(false);
  });

  it("still sends check-outs to a member who only turned check-ins off", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      notification_preferences: { data: [{ member_id: "m1", kind: "prickle_checkin", channel: "slack", enabled: false }] },
    });

    expect(await checkout()).toBe(1);
  });

  it("skips an attendee who answered both questions and logged every project", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      prickle_checkins: { data: [{ id: "c1", member_id: "m1", prickle_id: "p1", feelings_before: [], need: null, session_rating: 4, feelings_after: ["calm"] }] },
      writing_progress_entries: { data: [{ id: "e1", member_id: "m1", prickle_id: "p1", project_id: "proj1", measure: "words" }] },
    });

    expect(await checkout()).toBe(0);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("still sends a fully answered check-out for a project not yet logged, asking only about that one", async () => {
    setup([goalRow("g1", "m1", "proj1", "words"), goalRow("g2", "m1", "proj2", "scenes", "Memoir")], {
      prickle_checkins: { data: [{ id: "c1", member_id: "m1", prickle_id: "p1", feelings_before: [], need: null, session_rating: 4, feelings_after: ["calm"] }] },
      writing_progress_entries: { data: [{ id: "e1", member_id: "m1", prickle_id: "p1", project_id: "proj1", measure: "words" }] },
    });

    expect(await checkout()).toBe(1);
    const ids = sendSlackDM.mock.calls[0][0].blocks!.map((b: any) => b.block_id);
    expect(ids).toContain("quick_log:p1:proj2:scenes");
    expect(ids).not.toContain("quick_log:p1:proj1:words");
  });

  it("shows answers the attendee already saved", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")], {
      prickle_checkins: { data: [{ id: "c1", member_id: "m1", prickle_id: "p1", feelings_before: ["tired"], need: null, session_rating: 4, feelings_after: [] }] },
    });

    await checkout();
    const [, rating, feelingsAfter] = sendSlackDM.mock.calls[0][0].blocks!;
    expect(rating.elements.filter((e: any) => e.style === "primary").map((e: any) => e.value)).toEqual(["4"]);
    expect(feelingsAfter.accessory.initial_options).toBeUndefined();
  });

  it("doesn't prompt the same attendee twice for one prickle", async () => {
    setup([goalRow("g1", "m1", "proj1", "words")]);

    await checkout();
    expect(await checkout()).toBe(0);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });
});

describe("tryRecordCheckinDM", () => {
  it("is true only for the first record of a (prickle, member, kind)", async () => {
    fake = createFakeSupabase({ prickle_checkin_dm_log: dmLog() });
    expect(await tryRecordCheckinDM(fake, "p1", "m1", "prickle_checkin")).toBe(true);
    expect(await tryRecordCheckinDM(fake, "p1", "m1", "prickle_checkin")).toBe(false);
    expect(await tryRecordCheckinDM(fake, "p1", "m1", "prickle_checkout")).toBe(true);
    expect(await tryRecordCheckinDM(fake, "p1", "m2", "prickle_checkin")).toBe(true);
  });
});

describe("sendTestCheckinDM", () => {
  const PRICKLE_REF = { id: "p1", typeName: "Progress Prickle" };
  const answered = {
    id: "c1",
    member_id: "m1",
    prickle_id: "p1",
    feelings_before: ["tired"],
    need: "company",
    session_rating: 4,
    feelings_after: ["calm"],
  };

  function setup(extra: FakeTables = {}) {
    fake = createFakeSupabase({
      writing_goals: { data: [goalRow("g1", "m1", "proj1", "words", "Novel"), goalRow("g2", "m2", "proj2", "scenes", "Memoir")] },
      members: { data: [{ id: "m1" }, { id: "m2" }] },
      prickle_checkin_dm_log: dmLog(),
      ...extra,
    });
  }

  const loggedAny = () =>
    fake.queries.some((q) => q.table === "prickle_checkin_dm_log" && q.calls.some((c) => c.method === "insert"));

  it("sends the check-in marked as a test, even when already answered, without logging it", async () => {
    setup({ prickle_checkins: { data: [answered] } });

    expect(await sendTestCheckinDM(fake, "m1", PRICKLE_REF, "prickle_checkin")).toBeNull();

    const dm = sendSlackDM.mock.calls[0][0];
    expect(dm.slackUserId).toBe("U-m1");
    expect(dm.text).toMatch(/^\[Test\] Ready for Progress Prickle/);
    expect(dm.blocks![0].elements[0].text).toMatch(/Test send/);
    expect(dm.blocks![1].block_id).toBe("prickle_checkin:p1:feelings_before");
    expect(dm.blocks![1].accessory.initial_options.map((o: any) => o.value)).toEqual(["tired"]);
    expect(loggedAny()).toBe(false);
  });

  it("sends the check-out with a quick-log for only that member's goals", async () => {
    setup();

    expect(await sendTestCheckinDM(fake, "m1", PRICKLE_REF, "prickle_checkout")).toBeNull();

    const dm = sendSlackDM.mock.calls[0][0];
    expect(dm.text).toBe("[Test] Checking out of Progress Prickle: how did it go?");
    expect(dm.blocks!.map((b: any) => b.block_id).filter(Boolean)).toEqual([
      "prickle_checkin:p1:session_rating",
      "prickle_checkin:p1:feelings_after",
      "quick_log:p1:proj1:words",
    ]);
    expect(loggedAny()).toBe(false);
  });

  it("doesn't block the real DM afterwards", async () => {
    setup();
    await sendTestCheckinDM(fake, "m1", PRICKLE_REF, "prickle_checkin");
    expect(await tryRecordCheckinDM(fake, "p1", "m1", "prickle_checkin")).toBe(true);
  });

  it("reports a member with no matched Slack account", async () => {
    setup();
    expect(await sendTestCheckinDM(fake, "m-unknown", PRICKLE_REF, "prickle_checkin")).toMatch(/No Slack account/);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("sends even when the admin turned that kind off: they just asked for it", async () => {
    setup({ notification_preferences: { data: [{ member_id: "m1", kind: "prickle_checkin", channel: "slack", enabled: false }] } });
    expect(await sendTestCheckinDM(fake, "m1", PRICKLE_REF, "prickle_checkin")).toBeNull();
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });

  it("reports a Slack send that failed", async () => {
    setup();
    sendSlackDM.mockRejectedValueOnce(new Error("channel_not_found"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendTestCheckinDM(fake, "m1", PRICKLE_REF, "prickle_checkin")).toMatch(/Slack didn't accept/);
  });
});
