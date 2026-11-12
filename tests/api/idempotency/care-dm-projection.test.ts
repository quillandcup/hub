import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectCareFromDms } from "@/lib/care-dm";
import type { Db } from "@/lib/data/db";
import { createRepos } from "@/lib/data/repos";
import { SLACK_DM_SCOPES } from "@/lib/slack-connect";
import { createRunMembers, createRunUser, deleteRunMembers, type PeopleMember } from "@/tests/helpers/people-fixtures";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

/**
 * Hedgie Care fills in who spoke last from the Slack DMs a staff member tracks (lib/care-dm.ts). Against the real database:
 * running it again changes nothing (idempotent), it can be rebuilt from Bronze at any time, it writes no audit rows (the two
 * message-time columns are left out of the audit trigger), it reads only metadata, and it never reads a DM that is not the
 * staff member's.
 */
const admin = getTestSupabaseAdminClient();
const db = admin as unknown as Db;
const RUN = `${Date.now()}`;
const slack = { cm: `UCM${RUN}`, ada: `UADA${RUN}`, bo: `UBO${RUN}` };
const dm = { ada: `DADA${RUN}`, others: `DOTH${RUN}` };
const SECRET_TEXT = `a private sentence ${RUN}`;

let members: PeopleMember[] = [];
let userId = "";

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());
const repos = () => createRepos(db);
const message = (channel_id: string, user_id: string, occurred_at: string, extra: Record<string, unknown> = {}) => ({
  channel_id,
  message_ts: `${Date.parse(occurred_at) / 1000}.${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
  user_id,
  occurred_at,
  text: SECRET_TEXT,
  raw_payload: { text: SECRET_TEXT },
  ...extra,
});
const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  members = await createRunMembers(db, "care-dm-proj", RUN, 3); // [cm, ada, bo]
  userId = await createRunUser(admin, "care-dm-proj", RUN);
  check((await db.from("members").update({ user_id: userId }).eq("id", members[0].id)).error);
  check((await db.from("member_slack_connections").insert({ member_id: members[0].id, slack_user_id: slack.cm, scopes: [...SLACK_DM_SCOPES] })).error);
  check((await db.from("chat_slack_authors").insert([
    { slack_user_id: slack.cm, member_id: members[0].id },
    { slack_user_id: slack.ada, member_id: members[1].id },
    { slack_user_id: slack.bo, member_id: members[2].id },
  ])).error);
  check((await db.schema("bronze").from("slack_channels").insert([dm.ada, dm.others].map((channel_id) => ({ channel_id, name: "", is_im: true, is_private: true, raw_payload: {} })))).error);
  check((await db.schema("bronze").from("slack_channel_members").insert([
    { channel_id: dm.ada, user_id: slack.cm },
    { channel_id: dm.ada, user_id: slack.ada },
    // A DM between two other people, which she must never be able to read by naming it.
    { channel_id: dm.others, user_id: slack.ada },
    { channel_id: dm.others, user_id: slack.bo },
  ])).error);
  check((await db.schema("bronze").from("slack_messages").insert([
    message(dm.ada, slack.cm, "2026-03-11T10:00:00.000Z"),
    message(dm.ada, slack.ada, "2026-03-11T14:00:00.000Z"),
    message(dm.ada, slack.ada, "2026-03-12T08:00:00.000Z", { deleted_at: "2026-03-12T09:00:00.000Z" }),
    message(dm.ada, slack.cm, "2026-03-12T10:00:00.000Z", { message_type: "channel_join" }),
    message(dm.others, slack.bo, "2026-03-12T10:00:00.000Z"),
  ])).error);
});

afterAll(async () => {
  for (const channel of [dm.ada, dm.others]) {
    await db.schema("bronze").from("slack_messages").delete().eq("channel_id", channel);
    await db.schema("bronze").from("slack_channel_members").delete().eq("channel_id", channel);
    await db.schema("bronze").from("slack_channels").delete().eq("channel_id", channel);
  }
  await db.from("chat_slack_authors").delete().in("member_id", members.map((m) => m.id));
  await db.from("member_slack_connections").delete().eq("member_id", members[0].id);
  await deleteRunMembers(db, members); // cascades to their engagements and tracked DMs
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("projecting tracked Slack DMs into a Hedgie Care engagement", () => {
  it("fills in who spoke last, is idempotent, rebuilds from Bronze, writes no audit rows and reads only metadata", async () => {
    const opened = await repos().care.open({
      memberId: members[1].id,
      reason: "check_in",
      channel: "slack_dm",
      periodEndsOn: "2026-04-10",
      openedBy: userId,
      openedAt: "2026-03-10T15:00:00.000Z",
    });
    if (!opened.ok) throw new Error("expected the engagement to open");
    const id = opened.engagement.id;
    await repos().careDms.track({ trackedBy: userId, channelId: dm.ada, memberId: members[1].id });
    const auditRows = async () => {
      const { data, error } = await db.from("audit_log").select("id").eq("entity_type", "care_engagement").eq("entity_id", id);
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    };
    const audited = await auditRows();
    const times = async () => {
      const e = (await repos().care.byId(id))!;
      return [iso(e.last_staff_message_at), iso(e.last_member_message_at)];
    };

    const first = await projectCareFromDms({ care: repos().care, careDms: repos().careDms, service: repos() }, { userId });

    expect(first).toMatchObject({ tracked: 1, engagements: 1, moved: 2, incomplete: false });
    expect(await times()).toEqual(["2026-03-11T10:00:00.000Z", "2026-03-11T14:00:00.000Z"]);

    const again = await projectCareFromDms({ care: repos().care, careDms: repos().careDms, service: repos() }, { userId });
    expect(again).toMatchObject({ engagements: 1, moved: 0 });
    expect(await times()).toEqual(["2026-03-11T10:00:00.000Z", "2026-03-11T14:00:00.000Z"]);

    // Rebuilt from Bronze: clear what was derived and run it again.
    check((await db.from("care_engagements").update({ last_staff_message_at: "2026-03-10T15:00:00.000Z", last_member_message_at: null }).eq("id", id)).error);
    await projectCareFromDms({ care: repos().care, careDms: repos().careDms, service: repos() }, "all");
    expect(await times()).toEqual(["2026-03-11T10:00:00.000Z", "2026-03-11T14:00:00.000Z"]);

    // The audit log never saw the derived times (the manual reset above is excluded from it too).
    expect(await auditRows()).toBe(audited);
  });

  it("never reads a DM that is not hers, even when a tracked row names it", async () => {
    const forBo = await repos().care.open({ memberId: members[2].id, reason: "check_in", channel: "slack_dm", periodEndsOn: "2026-04-10", openedBy: userId, openedAt: "2026-03-10T15:00:00.000Z" });
    if (!forBo.ok) throw new Error("expected the engagement to open");
    // The table's own policy only checks whose row it is: this row names a DM between Ada and Bo.
    await repos().careDms.track({ trackedBy: userId, channelId: dm.others, memberId: members[2].id });

    const result = await projectCareFromDms({ care: repos().care, careDms: repos().careDms, service: repos() }, { userId });

    expect(result.moved).toBe(0);
    const e = (await repos().care.byId(forBo.engagement.id))!;
    expect(iso(e.last_member_message_at)).toBeNull();
  });

  it("asks the database for who and when only: the function returns no text", async () => {
    const writes = await repos().slackMessages.lastWritesIn([dm.ada]);

    expect(writes.map((w) => [w.user_id, w.last_at])).toEqual(
      [[slack.cm, "2026-03-11T10:00:00.000Z"], [slack.ada, "2026-03-11T14:00:00.000Z"]].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    );
    expect(JSON.stringify(writes)).not.toContain(SECRET_TEXT);
  });
});
