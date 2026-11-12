import { describe, expect, it } from "vitest";
import { findOwnDm, findOwnDmWith, loadCareDmTab, ownDirectMessages, ownSlackIdentity, projectCareFromDms, trackedChannelIds } from "@/lib/care-dm";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { SLACK_DM_SCOPES } from "@/lib/slack-connect";
import { useFakeClock } from "@/tests/helpers/fake-clock";

// People. The community manager (CM) has an account and a member profile with a connected Slack; everything else is fake.
const CM_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222"; // another staff member, with her own tracked DMs
const ADMIN_USER = "33333333-3333-4333-8333-333333333333";
const CM = "mbr_CCCCCCCCCCC1";
const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
const STAFF_MEMBER = "mbr_SSSSSSSSSSS1"; // in the staff table
const ADMIN_MEMBER = "mbr_SSSSSSSSSSS2"; // behind an admin account, not in the staff table
const OTHER_CM = "mbr_CCCCCCCCCCC2"; // the other staff user's member profile

const SLACK = { cm: "U0CM00001", ada: "U0ADA0001", bo: "U0BO00001", staff: "U0STAFF01", admin: "U0ADMIN01", stranger: "U0STRANG1", other: "U0OTHER01" };
const DM = { ada: "D0ADA0001", bo: "D0BO00001", staff: "D0STAFF01", admin: "D0ADMIN01", stranger: "D0STRANG1", self: "D0SELF001", others: "D0OTHERS1", group: "G0GROUP01", left: "D0LEFT001" };
const SECRET_TEXT = "a private sentence that must never leave Slack's content columns";

const connection = (member_id: string, slack_user_id: string, over: Record<string, unknown> = {}) => ({
  member_id,
  slack_user_id,
  team_id: null,
  scopes: [...SLACK_DM_SCOPES, "chat:write"],
  connected_at: "2026-01-01T00:00:00.000Z",
  revoked_at: null,
  access_secret_id: null,
  refresh_secret_id: null,
  expires_at: null,
  dms_completed_at: null, dms_pulled_at: null,
  read_pulled_at: null,
  ...over,
});

const im = (channel_id: string, extra: Record<string, unknown> = {}) => ({ channel_id, name: "", is_im: true, is_private: true, ...extra });
const inChannel = (channel_id: string, ...users: string[]) => users.map((user_id) => ({ channel_id, user_id, left_at: null, imported_at: "2026-01-01T00:00:00.000Z" }));
const msg = (channel_id: string, user_id: string, occurred_at: string, extra: Record<string, unknown> = {}) => ({
  channel_id,
  message_ts: `${Date.parse(occurred_at) / 1000}.${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
  user_id,
  occurred_at,
  text: SECRET_TEXT,
  ...extra,
});

function world(over: { messages?: ReturnType<typeof msg>[]; connectionOver?: Record<string, unknown> | null } = {}) {
  const data = new InMemoryDataset({
    members: [
      { id: CM, name: "Cam Example", email: "cm@example.test", userId: CM_USER },
      { id: ADA, name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
      { id: BO, name: "Bo Example", email: "bo@example.test" },
      { id: STAFF_MEMBER, name: "Sam Staffer", email: "staffer@example.test" },
      { id: ADMIN_MEMBER, name: "Alex Admin", email: "admin@example.test", userId: ADMIN_USER },
      { id: OTHER_CM, name: "Olly Example", email: "olly@example.test", userId: OTHER_USER },
    ],
    userProfiles: [
      { id: CM_USER, email: "cm@example.test", role: "community_manager" },
      { id: OTHER_USER, email: "olly@example.test", role: "community_manager" },
      { id: ADMIN_USER, email: "admin@example.test", role: "admin" },
    ],
    staff: [{ id: "staff_AAAAAAAAAAA1", email: "staffer@example.test", name: "Sam Staffer", role: "host", member_id: STAFF_MEMBER, hire_date: null, notes: null, created_at: null, updated_at: null }],
    chatSlackAuthors: [
      { slack_user_id: SLACK.cm, member_id: CM },
      { slack_user_id: SLACK.ada, member_id: ADA },
      { slack_user_id: SLACK.bo, member_id: BO },
      { slack_user_id: SLACK.staff, member_id: STAFF_MEMBER },
      { slack_user_id: SLACK.admin, member_id: ADMIN_MEMBER },
      { slack_user_id: SLACK.other, member_id: OTHER_CM },
    ],
    slackConnections: [
      ...(over.connectionOver === null ? [] : [connection(CM, SLACK.cm, over.connectionOver)]),
      connection(OTHER_CM, SLACK.other),
    ],
    slackChannels: [
      im(DM.ada),
      im(DM.bo),
      im(DM.staff),
      im(DM.admin),
      im(DM.stranger),
      im(DM.self),
      im(DM.others),
      im(DM.left),
      { channel_id: DM.group, name: "", is_mpim: true, is_private: true },
    ],
    slackChannelMembers: [
      ...inChannel(DM.ada, SLACK.cm, SLACK.ada),
      ...inChannel(DM.bo, SLACK.bo, SLACK.cm),
      ...inChannel(DM.staff, SLACK.cm, SLACK.staff),
      ...inChannel(DM.admin, SLACK.cm, SLACK.admin),
      ...inChannel(DM.stranger, SLACK.cm, SLACK.stranger),
      ...inChannel(DM.self, SLACK.cm),
      // Not hers: two members.
      ...inChannel(DM.others, SLACK.ada, SLACK.bo),
      ...inChannel(DM.group, SLACK.cm, SLACK.ada, SLACK.bo),
      // She left (or Slack closed it): not hers any more.
      ...inChannel(DM.left, SLACK.cm, SLACK.ada).map((m) => (m.user_id === SLACK.cm ? { ...m, left_at: "2026-02-01T00:00:00.000Z" } : m)),
    ],
    slackMessages: over.messages ?? [],
    // The Hub has her DM with Ada in Hub Chat (she is in it), and nothing for the one with Bo.
    chatChannels: [{ id: "chn_AAAAAAAAAAA1", slack_channel_id: DM.ada, kind: "dm", visibility: "private" }],
    chatChannelMembers: [{ channel_id: "chn_AAAAAAAAAAA1", member_id: CM, source: "slack", left_at: null }],
  });
  const repos = createInMemoryRepos(data);
  return { data, repos };
}

/** Records which methods of a repository were called and with what, so a test can show nothing but metadata was asked for. */
function spy<T extends object>(target: T, calls: { method: string; args: unknown[] }[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === "function"
        ? (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            return value.apply(obj, args);
          }
        : value;
    },
  });
}

const open = (repos: Repos, over: Partial<Parameters<Repos["care"]["open"]>[0]> = {}) =>
  repos.care.open({ memberId: ADA, reason: "check_in", channel: "slack_dm", periodEndsOn: "2026-04-10", openedBy: CM_USER, openedAt: "2026-03-10T15:00:00.000Z", ...over });
const opened = async (repos: Repos, over: Partial<Parameters<Repos["care"]["open"]>[0]> = {}) => {
  const result = await open(repos, over);
  if (!result.ok) throw new Error("expected the engagement to open");
  return result.engagement;
};
const track = (repos: Repos, channelId: string, memberId: string, trackedBy = CM_USER) => repos.careDms.track({ trackedBy, channelId, memberId });
const times = async (repos: Repos, id: string) => {
  const e = (await repos.care.byId(id))!;
  return [e.last_staff_message_at, e.last_member_message_at];
};
const deps = (repos: Repos) => ({ care: repos.care, careDms: repos.careDms, service: repos });

describe("ownSlackIdentity", () => {
  it("finds the member and the Slack user they connected, by account or by email", async () => {
    const { repos } = world();
    expect(await ownSlackIdentity(repos, { id: CM_USER })).toEqual({ memberId: CM, slackUserId: SLACK.cm, connected: true, hasDmScopes: true });
    expect(await ownSlackIdentity(repos, { id: "99999999-9999-4999-8999-999999999999", email: "cm@example.test" })).toMatchObject({ memberId: CM });
  });

  it("says when there is no member, no connection, a connection Slack dropped, or one without the DM permissions", async () => {
    const { repos } = world();
    expect(await ownSlackIdentity(repos, { id: ADMIN_USER.replace("3333", "4444") })).toEqual({ memberId: null, slackUserId: null, connected: false, hasDmScopes: false });
    expect(await ownSlackIdentity(repos, { id: ADMIN_USER })).toEqual({ memberId: ADMIN_MEMBER, slackUserId: null, connected: false, hasDmScopes: false });
    expect(await ownSlackIdentity(world({ connectionOver: { revoked_at: "2026-02-01T00:00:00.000Z" } }).repos, { id: CM_USER })).toEqual({
      memberId: CM,
      slackUserId: SLACK.cm,
      connected: false,
      hasDmScopes: false,
    });
    expect(await ownSlackIdentity(world({ connectionOver: { scopes: ["chat:write"] } }).repos, { id: CM_USER })).toMatchObject({ connected: true, hasDmScopes: false });
  });
});

describe("staff members (StaffRepository.memberIds, the one definition)", () => {
  it("is the staff table's members and the members behind admin, assistant and community manager accounts", async () => {
    expect(await world().repos.staff.memberIds()).toEqual(new Set([STAFF_MEMBER, ADMIN_MEMBER, CM, OTHER_CM]));
  });
});

describe("ownDirectMessages: only her own 1:1 DMs with members who are not staff", () => {
  it("lists her DMs with members, and leaves out someone else's DM, a group DM, a DM with herself, staff, someone the Hub doesn't know and one she left", async () => {
    const dms = await ownDirectMessages(world().repos, SLACK.cm, CM);

    expect(dms.map((d) => [d.channelId, d.memberId, d.counterpartSlackId])).toEqual([
      [DM.ada, ADA, SLACK.ada],
      [DM.bo, BO, SLACK.bo],
    ]);
    const channels = dms.map((d) => d.channelId);
    for (const notHers of [DM.others, DM.group, DM.self, DM.staff, DM.admin, DM.stranger, DM.left]) expect(channels).not.toContain(notHers);
  });

  it("is empty for a Slack user with no DMs", async () => {
    expect(await ownDirectMessages(world().repos, "U0NOBODY1", null)).toEqual([]);
  });

  it("finds one of her DMs by channel or by member, and refuses everything else", async () => {
    const { repos } = world();
    const user = { id: CM_USER, email: "cm@example.test" };

    expect(await findOwnDm(repos, user, DM.ada)).toMatchObject({ memberId: ADA });
    expect(await findOwnDmWith(repos, user, BO)).toMatchObject({ channelId: DM.bo });
    for (const channel of [DM.others, DM.staff, DM.group, "D0NOSUCH01"]) expect(await findOwnDm(repos, user, channel)).toBeNull();
    expect(await findOwnDmWith(repos, user, STAFF_MEMBER)).toBeNull();
    expect(await findOwnDm(repos, { id: ADMIN_USER }, DM.ada)).toBeNull(); // no Slack connection, no DMs
  });
});

describe("loadCareDmTab", () => {
  const now = new Date("2026-03-12T15:00:00.000Z");
  const user = { id: CM_USER, email: "cm@example.test" };
  const on = { bridgeOn: true, trackedChannelIds: new Set<string>(), now };

  it.each([
    ["no member profile", { id: "99999999-9999-4999-8999-999999999999" }, on, "no_member"],
    ["the bridge is off for her", user, { ...on, bridgeOn: false }, "flag_off"],
    ["no Slack connected", { id: ADMIN_USER }, on, "not_connected"],
  ])("is unavailable when %s", async (_label, who, options, reason) => {
    expect(await loadCareDmTab(world().repos, who, options)).toEqual({ state: "unavailable", reason });
  });

  it("is unavailable when Slack dropped the connection, and when it lacks the DM permissions", async () => {
    expect(await loadCareDmTab(world({ connectionOver: { revoked_at: "2026-02-01T00:00:00.000Z" } }).repos, user, on)).toEqual({ state: "unavailable", reason: "not_connected" });
    expect(await loadCareDmTab(world({ connectionOver: { scopes: ["chat:write"] } }).repos, user, on)).toEqual({ state: "unavailable", reason: "needs_reconnect" });
  });

  it("lists her DMs newest first with the name the community knows them by, who wrote last, and which she tracks", async () => {
    const { repos } = world({
      messages: [
        msg(DM.ada, SLACK.cm, "2026-03-09T10:00:00.000Z"),
        msg(DM.ada, SLACK.ada, "2026-03-11T10:00:00.000Z"),
        msg(DM.bo, SLACK.bo, "2026-03-05T10:00:00.000Z"),
        msg(DM.bo, SLACK.cm, "2026-03-06T10:00:00.000Z"),
        msg(DM.bo, SLACK.bo, "2026-03-10T10:00:00.000Z", { deleted_at: "2026-03-10T11:00:00.000Z" }),
        msg(DM.bo, SLACK.cm, "2026-03-11T12:00:00.000Z", { message_type: "channel_join" }),
        // Other people's DMs are never read.
        msg(DM.others, SLACK.ada, "2026-03-12T10:00:00.000Z"),
      ],
    });

    const tab = await loadCareDmTab(repos, user, { ...on, trackedChannelIds: new Set([DM.bo]), slackTeamId: "T0TEST" });

    expect(tab).toEqual({
      state: "ready",
      rows: [
        { channelId: DM.ada, memberId: ADA, memberName: "Ada E.", legalName: "Ada Example", tracked: false, lastAt: "2026-03-11T10:00:00.000Z", lastLabel: "yesterday", lastBy: "them", link: { href: "/chat/chn_AAAAAAAAAAA1", kind: "hub_chat" } },
        { channelId: DM.bo, memberId: BO, memberName: "Bo Example", legalName: null, tracked: true, lastAt: "2026-03-06T10:00:00.000Z", lastLabel: "6 days ago", lastBy: "you", link: { href: `https://slack.com/app_redirect?channel=${DM.bo}&team=T0TEST`, kind: "slack" } },
      ],
    });
  });

  it("lists a DM with no message in the Hub last, and an empty list when she has none", async () => {
    const quiet = await loadCareDmTab(world({ messages: [msg(DM.bo, SLACK.bo, "2026-03-05T10:00:00.000Z")] }).repos, user, on);
    expect(quiet).toMatchObject({ state: "ready" });
    if (quiet.state !== "ready") throw new Error("unreachable");
    expect(quiet.rows.map((r) => [r.channelId, r.lastAt, r.lastLabel, r.lastBy])).toEqual([
      [DM.bo, "2026-03-05T10:00:00.000Z", "7 days ago", "them"],
      [DM.ada, null, null, null],
    ]);

    const none = world();
    none.data.slackChannelMembers = [];
    expect(await loadCareDmTab(none.repos, user, on)).toEqual({ state: "ready", rows: [] });
  });

  it("reads only who wrote and when: nothing but the last-writes method of the messages is asked for, and no text, channel id of another DM or name of a stranger is in the answer", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T10:00:00.000Z"), msg(DM.others, SLACK.bo, "2026-03-11T10:00:00.000Z")] });
    const calls: { method: string; args: unknown[] }[] = [];

    const tab = await loadCareDmTab({ ...repos, slackMessages: spy(repos.slackMessages, calls) }, user, on);

    expect(calls.map((c) => c.method)).toEqual(["lastWritesIn"]);
    expect(calls[0].args[0]).toEqual([DM.ada, DM.bo]);
    const shown = JSON.stringify(tab);
    expect(shown).not.toContain(SECRET_TEXT);
    for (const hidden of [DM.others, DM.group, DM.staff, "Sam Staffer", "Alex Admin", "Olly Example"]) expect(shown).not.toContain(hidden);
  });
});

describe("trackedChannelIds", () => {
  it("is the channels a user tracks now", async () => {
    const { repos } = world();
    await track(repos, DM.ada, ADA);
    await track(repos, DM.bo, BO);
    await repos.careDms.untrack(CM_USER, DM.bo, "2026-03-01T00:00:00.000Z");
    expect(await trackedChannelIds(repos.careDms, CM_USER)).toEqual(new Set([DM.ada]));
  });
});

describe("projectCareFromDms: tracked DMs fill in who spoke last", () => {
  const fake = useFakeClock(() => Date.parse("2026-03-12T15:00:00.000Z"));

  it("sets both sides from her DM with the member: the latest message of each, threads and files included", async () => {
    const { repos } = world({
      messages: [
        msg(DM.ada, SLACK.cm, "2026-03-11T10:00:00.000Z"),
        msg(DM.ada, SLACK.ada, "2026-03-10T16:00:00.000Z"),
        msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z", { thread_ts: "1773000000.000100" }),
        msg(DM.ada, SLACK.cm, "2026-03-11T09:00:00.000Z", { message_type: "file_share" }),
      ],
    });
    const e = await opened(repos);
    await track(repos, DM.ada, ADA);

    const result = await projectCareFromDms(deps(repos), { userId: CM_USER });

    expect(result).toEqual({ tracked: 1, engagements: 1, moved: 2, incomplete: false });
    expect(await times(repos, e.id)).toEqual(["2026-03-11T10:00:00.000Z", "2026-03-11T14:00:00.000Z"]);
  });

  it("is idempotent and rebuildable: a second run changes nothing, and a Bronze rebuild with the same messages lands on the same times", async () => {
    const { repos, data } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    const e = await opened(repos);
    await track(repos, DM.ada, ADA);

    expect((await projectCareFromDms(deps(repos), "all")).moved).toBe(1);
    const once = await times(repos, e.id);
    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ engagements: 1, moved: 0 });
    expect(await times(repos, e.id)).toEqual(once);

    data.slackMessages = data.slackMessages.map((m) => ({ ...m }));
    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ moved: 0 });
    expect(await times(repos, e.id)).toEqual(once);
  });

  it("only moves forward: a manual log that is later stays, and older DM messages do not undo it", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    const e = await opened(repos);
    await repos.care.logMessage(e.id, "member", "2026-03-12T09:00:00.000Z");
    await track(repos, DM.ada, ADA);

    await projectCareFromDms(deps(repos), "all");

    expect(await times(repos, e.id)).toEqual(["2026-03-10T15:00:00.000Z", "2026-03-12T09:00:00.000Z"]);
  });

  it("ignores deleted messages, Slack's join and leave notices, bots and anyone else in the conversation", async () => {
    const { repos } = world({
      messages: [
        msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z", { deleted_at: "2026-03-11T15:00:00.000Z" }),
        msg(DM.ada, SLACK.cm, "2026-03-11T14:00:00.000Z", { message_type: "channel_join" }),
        msg(DM.ada, "B0SOMEBOT", "2026-03-11T14:00:00.000Z"),
        msg(DM.ada, SLACK.stranger, "2026-03-11T14:00:00.000Z"),
      ],
    });
    const e = await opened(repos);
    await track(repos, DM.ada, ADA);

    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ engagements: 1, moved: 0 });
    expect(await times(repos, e.id)).toEqual(["2026-03-10T15:00:00.000Z", null]);
  });

  it("counts a message from earlier the day it opened (Eastern), but not from the day before", async () => {
    // Opened 11:00 Eastern on March 10: that day starts at 04:00Z.
    const before = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-10T03:59:59.000Z")] });
    const e1 = await opened(before.repos);
    await track(before.repos, DM.ada, ADA);
    await projectCareFromDms(deps(before.repos), "all");
    expect((await times(before.repos, e1.id))[1]).toBeNull();

    const sameDay = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-10T04:00:00.000Z")] });
    const e2 = await opened(sameDay.repos);
    await track(sameDay.repos, DM.ada, ADA);
    await projectCareFromDms(deps(sameDay.repos), "all");
    expect((await times(sameDay.repos, e2.id))[1]).toBe("2026-03-10T04:00:00.000Z");
  });

  it("keeps that boundary on the spring clock-change day (23 hours long)", async () => {
    // Opened at noon Eastern on March 8: the day starts at 05:00Z, not 04:00Z.
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-08T04:59:59.000Z"), msg(DM.ada, SLACK.cm, "2026-03-08T05:00:00.000Z")] });
    const e = await opened(repos, { openedAt: "2026-03-08T16:00:00.000Z", periodEndsOn: "2026-04-08" });
    await track(repos, DM.ada, ADA);

    await projectCareFromDms(deps(repos), "all");

    expect((await times(repos, e.id))[1]).toBeNull();
    // Her message at the start of the day is before her opening one at noon: the later stored time wins.
    expect((await times(repos, e.id))[0]).toBe("2026-03-08T16:00:00.000Z");
  });

  it("keeps that boundary on the autumn clock-change day (25 hours long)", async () => {
    // Opened at noon Eastern on November 1: the day starts at 04:00Z.
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-11-01T03:59:59.000Z")] });
    const e = await opened(repos, { openedAt: "2026-11-01T17:00:00.000Z", periodEndsOn: "2026-12-01" });
    await track(repos, DM.ada, ADA);
    await projectCareFromDms(deps(repos), "all");
    expect((await times(repos, e.id))[1]).toBeNull();

    const later = world({ messages: [msg(DM.ada, SLACK.ada, "2026-11-01T04:00:00.000Z")] });
    const e2 = await opened(later.repos, { openedAt: "2026-11-01T17:00:00.000Z", periodEndsOn: "2026-12-01" });
    await track(later.repos, DM.ada, ADA);
    await projectCareFromDms(deps(later.repos), "all");
    expect((await times(later.repos, e2.id))[1]).toBe("2026-11-01T04:00:00.000Z");
  });

  it("touches only an OPEN engagement on the Slack DM channel that its owner tracks with that member", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z"), msg(DM.bo, SLACK.bo, "2026-03-11T14:00:00.000Z")] });
    const email = await opened(repos, { channel: "email" });
    const closed = await opened(repos, { memberId: BO });
    await repos.care.close(closed.id, "ran_its_course", "2026-03-11T00:00:00.000Z");
    const ownedBySomeoneElse = await opened(repos, { memberId: BO, ownedBy: OTHER_USER });
    await track(repos, DM.ada, ADA);
    await track(repos, DM.bo, BO);

    const result = await projectCareFromDms(deps(repos), "all");

    // Ada has an email engagement only: no Slack DM engagement to fill in. Bo's open one is owned by someone who does not track Bo's DM.
    expect(result.moved).toBe(0);
    expect((await times(repos, email.id))[1]).toBeNull();
    expect((await times(repos, closed.id))[1]).toBeNull();
    expect((await times(repos, ownedBySomeoneElse.id))[1]).toBeNull();
  });

  it("does nothing for DMs nobody tracks, and when the staff user has no engagement for them", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    const e = await opened(repos);
    expect(await projectCareFromDms(deps(repos), "all")).toEqual({ tracked: 0, engagements: 0, moved: 0, incomplete: false });

    await track(repos, DM.bo, BO);
    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ tracked: 1, engagements: 0, moved: 0 });
    expect((await times(repos, e.id))[1]).toBeNull();
  });

  it("reads nothing for a tracked row that names a conversation that is not hers, or a member who is not on the other side", async () => {
    const { repos } = world({ messages: [msg(DM.others, SLACK.ada, "2026-03-11T14:00:00.000Z"), msg(DM.bo, SLACK.bo, "2026-03-11T14:00:00.000Z"), msg(DM.staff, SLACK.staff, "2026-03-11T14:00:00.000Z")] });
    const e = await opened(repos);
    const forBo = await opened(repos, { memberId: BO });
    // Rows written straight to the table (RLS only checks whose row it is): a DM between two other people, a real DM of hers
    // filed under the wrong member, and a staff DM.
    await track(repos, DM.others, ADA);
    await track(repos, DM.bo, ADA);
    await track(repos, DM.staff, STAFF_MEMBER);
    const calls: { method: string; args: unknown[] }[] = [];

    const result = await projectCareFromDms({ ...deps(repos), service: { ...repos, slackMessages: spy(repos.slackMessages, calls) } }, "all");

    expect(result.moved).toBe(0);
    expect(calls.map((c) => c.method)).toEqual([]); // never even asked Bronze about them
    expect((await times(repos, e.id))[1]).toBeNull();
    expect((await times(repos, forBo.id))[1]).toBeNull();
  });

  it("can be limited to one staff user's tracked DMs, or to one DM", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z"), msg(DM.bo, SLACK.bo, "2026-03-11T14:00:00.000Z")] });
    const ada = await opened(repos);
    const bo = await opened(repos, { memberId: BO });
    await track(repos, DM.ada, ADA);
    await track(repos, DM.bo, BO);
    await track(repos, DM.bo, BO, OTHER_USER); // she tracks it too, with no engagement of her own

    expect(await projectCareFromDms(deps(repos), { userId: OTHER_USER })).toMatchObject({ tracked: 1, engagements: 0, moved: 0 });
    expect(await projectCareFromDms(deps(repos), { channelId: DM.bo })).toMatchObject({ tracked: 2, engagements: 1, moved: 1 });
    expect((await times(repos, ada.id))[1]).toBeNull();
    expect((await times(repos, bo.id))[1]).toBe("2026-03-11T14:00:00.000Z");
  });

  it("fills in by the owner's account when the engagement has no owner, and finds the owner's Slack by email when the account is not linked", async () => {
    const { repos, data } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    data.members.find((m) => m.id === CM)!.userId = null; // linked by email only
    const e = await opened(repos, { ownedBy: null });
    await track(repos, DM.ada, ADA);

    expect((await projectCareFromDms(deps(repos), "all")).moved).toBe(1);
    expect((await times(repos, e.id))[1]).toBe("2026-03-11T14:00:00.000Z");
  });

  it("skips a tracked DM whose owner has no Slack connection on record", async () => {
    const { repos } = world({ connectionOver: null, messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    await opened(repos);
    await track(repos, DM.ada, ADA);

    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ tracked: 1, engagements: 0, moved: 0 });
  });

  it("stops when its time is up, and the next run carries on", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    const e = await opened(repos);
    await track(repos, DM.ada, ADA);

    const stopped = await projectCareFromDms(deps(repos), "all", { deadline: fake.clock.now() });
    expect(stopped).toMatchObject({ incomplete: true, moved: 0 });
    expect((await times(repos, e.id))[1]).toBeNull();

    const finished = await projectCareFromDms(deps(repos), "all", { deadline: fake.clock.now() + 60_000 });
    expect(finished).toMatchObject({ incomplete: false, moved: 1 });
  });
});
