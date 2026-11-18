import { describe, expect, it } from "vitest";
import { findOwnDmWith, ownDirectMessages, ownDmAccess, ownSlackIdentity, projectCareFromDms } from "@/lib/care-dm";
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
  repos.care.open({ memberId: ADA, reason: "check_in", periodEndsOn: "2026-04-10", openedBy: CM_USER, openedAt: "2026-03-10T15:00:00.000Z", ...over });
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

  it("finds her DM with a member, and refuses everything else", async () => {
    const { repos } = world();
    const user = { id: CM_USER, email: "cm@example.test" };

    expect(await findOwnDmWith(repos, user, ADA)).toMatchObject({ channelId: DM.ada, memberId: ADA });
    expect(await findOwnDmWith(repos, user, BO)).toMatchObject({ channelId: DM.bo });
    expect(await findOwnDmWith(repos, user, STAFF_MEMBER)).toBeNull(); // staff are never offered
    expect(await findOwnDmWith(repos, user, "mbr_ZZZZZZZZZZZZ")).toBeNull(); // nobody she has a DM with
    expect(await findOwnDmWith(repos, { id: ADMIN_USER }, ADA)).toBeNull(); // no Slack connection, no DMs
  });
});

describe("ownDmAccess: whether her own Slack DMs can fill in her care plans", () => {
  const user = { id: CM_USER, email: "cm@example.test" };

  it("is ready when Slack is connected with the DM permissions and the bridge is on for her", async () => {
    expect(ownDmAccess(await ownSlackIdentity(world().repos, user), true)).toBe("ready");
  });

  it("needs Slack when it is not connected, was dropped, lacks the DM permissions, or the bridge is not on for her", async () => {
    expect(ownDmAccess(await ownSlackIdentity(world().repos, { id: ADMIN_USER }), true)).toBe("needs_slack"); // no connection
    expect(ownDmAccess(await ownSlackIdentity(world({ connectionOver: { revoked_at: "2026-02-01T00:00:00.000Z" } }).repos, user), true)).toBe("needs_slack");
    expect(ownDmAccess(await ownSlackIdentity(world({ connectionOver: { scopes: ["chat:write"] } }).repos, user), true)).toBe("needs_slack");
    expect(ownDmAccess(await ownSlackIdentity(world().repos, user), false)).toBe("needs_slack");
  });

  it("is no_member when her account has no member profile: there is no Slack account to connect, so nothing is offered", async () => {
    expect(ownDmAccess(await ownSlackIdentity(world().repos, { id: "99999999-9999-4999-8999-999999999999" }), true)).toBe("no_member");
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

    expect(result).toEqual({ tracked: 1, autoTracked: 0, engagements: 1, moved: 2, incomplete: false });
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

  it("touches only an OPEN care plan that its owner holds with the member whose DM they track, whatever the plan is about", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z"), msg(DM.bo, SLACK.bo, "2026-03-11T14:00:00.000Z")] });
    const open = await opened(repos, { reason: "writing_check_in" });
    const closed = await opened(repos, { memberId: BO });
    await repos.care.close(closed.id, "ran_its_course", "2026-03-11T00:00:00.000Z");
    const ownedBySomeoneElse = await opened(repos, { memberId: BO, ownedBy: OTHER_USER });
    await track(repos, DM.ada, ADA);
    await track(repos, DM.bo, BO);

    const result = await projectCareFromDms(deps(repos), "all");

    // Ada's plan is hers with her DM tracked: filled in. Bo's open one belongs to someone who tracks nothing, and her tracking of Bo's DM does not fill it.
    expect(result.moved).toBe(1);
    expect((await times(repos, open.id))[1]).toBe("2026-03-11T14:00:00.000Z");
    expect((await times(repos, closed.id))[1]).toBeNull();
    expect((await times(repos, ownedBySomeoneElse.id))[1]).toBeNull();
  });

  describe("tracks the owner's DM with the member of an open care plan", () => {
    it("tracks it when she holds an open plan, has a DM with them in Bronze and tracks nothing yet, then fills it in", async () => {
      const { repos } = world({ messages: [msg(DM.ada, SLACK.cm, "2026-03-11T10:00:00.000Z"), msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      const e = await opened(repos);

      const result = await projectCareFromDms(deps(repos), { userId: CM_USER });

      expect(result).toEqual({ tracked: 1, autoTracked: 1, engagements: 1, moved: 2, incomplete: false });
      expect((await repos.careDms.forUser(CM_USER)).map((dm) => [dm.channelId, dm.memberId])).toEqual([[DM.ada, ADA]]);
      expect(await times(repos, e.id)).toEqual(["2026-03-11T10:00:00.000Z", "2026-03-11T14:00:00.000Z"]);
    });

    it("tracks it in the nightly run for everyone too, and is idempotent", async () => {
      const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      await opened(repos);

      expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ autoTracked: 1, moved: 1 });
      expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ tracked: 1, autoTracked: 0, moved: 0 });
      expect(await repos.careDms.forUser(CM_USER)).toHaveLength(1);
    });

    it("tracks it again when an earlier row of hers was soft deleted (the opt-in design's leftovers): a plan is the reason, there is no choice to respect", async () => {
      const { repos, data } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      const e = await opened(repos);
      await track(repos, DM.ada, ADA);
      data.careTrackedDms[0].deleted_at = "2026-03-12T10:00:00.000Z";
      expect(await repos.careDms.forUser(CM_USER)).toEqual([]);

      expect(await projectCareFromDms(deps(repos), { userId: CM_USER })).toMatchObject({ autoTracked: 1, moved: 1 });
      expect((await repos.careDms.forUser(CM_USER)).map((dm) => dm.channelId)).toEqual([DM.ada]);
      expect((await times(repos, e.id))[1]).toBe("2026-03-11T14:00:00.000Z");
    });

    it("tracks the DM only for plans she holds, not for a member whose open plan someone else holds", async () => {
      const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z"), msg(DM.bo, SLACK.bo, "2026-03-11T14:00:00.000Z")] });
      await opened(repos);
      await opened(repos, { memberId: BO, ownedBy: OTHER_USER });

      const result = await projectCareFromDms(deps(repos), "all");

      expect(result.autoTracked).toBe(1);
      expect((await repos.careDms.forUser(CM_USER)).map((dm) => dm.channelId)).toEqual([DM.ada]);
    });

    it("follows a plan to its new owner: once a hand-over is accepted her DM is tracked and read, not the previous owner's", async () => {
      const { repos, data } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      const plan = await opened(repos, { ownedBy: OTHER_USER });
      expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ autoTracked: 0, moved: 0 }); // Olly has no DM with Ada

      expect((await createInMemoryRepos(data, { signedInAs: OTHER_USER }).care.proposeHandover(plan.id, CM_USER)).ok).toBe(true);
      expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ autoTracked: 0, moved: 0 }); // an offer changes nothing
      expect((await createInMemoryRepos(data, { signedInAs: CM_USER }).care.acceptHandover(plan.id)).ok).toBe(true);

      expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ autoTracked: 1, moved: 1 });
      expect((await times(repos, plan.id))[1]).toBe("2026-03-11T14:00:00.000Z");
    });

    it("tracks nothing for a member she has no DM with, for a staff member, or when she has no Slack connection", async () => {
      const { repos, data } = world({ messages: [msg(DM.staff, SLACK.staff, "2026-03-11T14:00:00.000Z")] });
      data.members.push({ id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" });
      await opened(repos, { memberId: "mbr_AAAAAAAAAAA3" }); // no DM with her
      await opened(repos, { memberId: STAFF_MEMBER }); // a DM, but staff are never tracked
      expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ tracked: 0, autoTracked: 0, moved: 0 });

      const disconnected = world({ connectionOver: null, messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      await opened(disconnected.repos);
      expect(await projectCareFromDms(deps(disconnected.repos), "all")).toMatchObject({ tracked: 0, autoTracked: 0 });
    });

    it("does not track for a single DM's live message, which only reads what is already tracked", async () => {
      const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      await opened(repos);

      expect(await projectCareFromDms(deps(repos), { channelId: DM.ada })).toMatchObject({ tracked: 0, autoTracked: 0, moved: 0 });
      expect(await repos.careDms.forUser(CM_USER)).toEqual([]);
    });

    it("stops when its time is up before the DMs are looked at, and the next run tracks them", async () => {
      const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
      await opened(repos);

      expect(await projectCareFromDms(deps(repos), "all", { deadline: fake.clock.now() })).toMatchObject({ incomplete: true, autoTracked: 0 });
      expect(await projectCareFromDms(deps(repos), "all", { deadline: fake.clock.now() + 60_000 })).toMatchObject({ incomplete: false, autoTracked: 1 });
    });
  });

  it("does nothing when nothing is tracked and no care plan is open, and ignores a tracked DM the staff user has no care plan for", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    expect(await projectCareFromDms(deps(repos), "all")).toEqual({ tracked: 0, autoTracked: 0, engagements: 0, moved: 0, incomplete: false });

    const e = await opened(repos);
    await track(repos, DM.bo, BO); // a DM with no care plan behind it: an orphan, ignored
    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ tracked: 2, autoTracked: 1, engagements: 1 });
    expect((await times(repos, e.id))[1]).toBe("2026-03-11T14:00:00.000Z");
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

  it("reads no one's DM for a plan with no owner (whoever opened it does not own it), and finds an owner's Slack by email when the account is not linked", async () => {
    const { repos, data } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    data.members.find((m) => m.id === CM)!.userId = null; // linked by email only
    const ownerless = await opened(repos, { ownedBy: null });
    await track(repos, DM.ada, ADA);
    expect(await projectCareFromDms(deps(repos), "all")).toMatchObject({ engagements: 0, moved: 0 });
    expect((await times(repos, ownerless.id))[1]).toBeNull();

    const { repos: owned, data: ownedData } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T14:00:00.000Z")] });
    ownedData.members.find((m) => m.id === CM)!.userId = null;
    const e = await opened(owned);
    await track(owned, DM.ada, ADA);
    expect((await projectCareFromDms(deps(owned), "all")).moved).toBe(1);
    expect((await times(owned, e.id))[1]).toBe("2026-03-11T14:00:00.000Z");
  });

  it("reads only who wrote and when: nothing but the last-writes method of the messages is asked for, and no text is in anything it returns", async () => {
    const { repos } = world({ messages: [msg(DM.ada, SLACK.ada, "2026-03-11T10:00:00.000Z"), msg(DM.others, SLACK.bo, "2026-03-11T10:00:00.000Z")] });
    await opened(repos);
    await track(repos, DM.ada, ADA);
    const calls: { method: string; args: unknown[] }[] = [];

    const result = await projectCareFromDms({ ...deps(repos), service: { ...repos, slackMessages: spy(repos.slackMessages, calls) } }, "all");

    expect(calls.map((c) => c.method)).toEqual(["lastWritesIn"]);
    expect(calls[0].args[0]).toEqual([DM.ada]); // never another DM
    expect(JSON.stringify(result)).not.toContain(SECRET_TEXT);
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
