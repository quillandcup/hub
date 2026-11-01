import { describe, it, expect } from "vitest";
import type { ActivityRow } from "@/lib/data/activities";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import {
  loadAttendedMemberIds,
  loadIntroChannelId,
  loadIntroducedMemberIds,
  loadLastAttendanceByMember,
} from "@/lib/newcomer-signals";
import { SLACK_INTRO_CHANNEL } from "@/lib/config";
import { InMemoryAttendanceRepository } from "@/lib/data/attendance";

// Slack activity comes from the activity repository (its filters and chunking are in its contract); the twin stands in here.
let dataset = new InMemoryDataset();
const repos = () => createInMemoryRepos(dataset);

const slack = (id: string, member: string, type: string, channel: string): ActivityRow => ({
  id,
  member_id: member,
  activity_type: type,
  activity_category: "communication",
  title: "message",
  source: "slack",
  occurred_at: "2026-09-01T10:00:00Z",
  created_at: "2026-09-01T10:00:00Z",
  related_id: id,
  description: null,
  engagement_value: null,
  actor_kind: "member",
  actor_user_id: null,
  acting_as_member_id: null,
  duration_minutes: null,
  prickle_id: null,
  data: { channel_name: channel },
});

describe("loadIntroducedMemberIds", () => {
  it("returns members with a top-level Slack message in the intro channel, not replies or other channels", async () => {
    dataset = new InMemoryDataset({
      activities: [
        slack("a1", "m1", "slack_message", SLACK_INTRO_CHANNEL),
        slack("a2", "m1", "slack_message", SLACK_INTRO_CHANNEL),
        slack("a3", "m2", "slack_thread_reply", SLACK_INTRO_CHANNEL),
        slack("a4", "m3", "slack_message", "random"),
        slack("a5", "m4", "slack_message", SLACK_INTRO_CHANNEL),
      ],
    });

    expect(await loadIntroducedMemberIds(repos(), ["m1", "m2", "m3"])).toEqual(new Set(["m1"]));
  });

  it("returns nothing for no members", async () => {
    dataset = new InMemoryDataset({ activities: [slack("a1", "m1", "slack_message", SLACK_INTRO_CHANNEL)] });

    expect(await loadIntroducedMemberIds(repos(), [])).toEqual(new Set());
  });
});

const attended = (rows: { memberId: string; joinTime: string }[]) =>
  new InMemoryAttendanceRepository(rows.map((r, i) => ({ id: `att_${i}`, prickleId: "prkl_AAAAAAAAAAA1", leaveTime: r.joinTime, ...r })));

describe("loadAttendedMemberIds", () => {
  it("returns members with any prickle attendance", async () => {
    const repo = attended([
      { memberId: "m2", joinTime: "2026-09-01T15:00:00Z" },
      { memberId: "m2", joinTime: "2026-09-02T15:00:00Z" },
    ]);

    expect(await loadAttendedMemberIds(repo, ["m1", "m2"])).toEqual(new Set(["m2"]));
  });
});

describe("loadLastAttendanceByMember", () => {
  it("keeps each member's latest join across their attendance rows", async () => {
    const repo = attended([
      { memberId: "m1", joinTime: "2026-09-01T15:00:00Z" },
      { memberId: "m1", joinTime: "2026-10-05T15:00:00Z" },
      { memberId: "m1", joinTime: "2026-09-20T15:00:00Z" },
      { memberId: "m2", joinTime: "2026-08-01T15:00:00Z" },
    ]);

    const last = await loadLastAttendanceByMember(repo, ["m1", "m2", "m3"]);

    expect(last.get("m1")).toEqual(new Date("2026-10-05T15:00:00Z"));
    expect(last.get("m2")).toEqual(new Date("2026-08-01T15:00:00Z"));
    expect(last.has("m3")).toBe(false);
  });
});

describe("loadIntroChannelId", () => {
  it("reads the intro channel's Slack id from bronze", async () => {
    dataset = new InMemoryDataset({
      slackChannels: [
        { channel_id: "C123", name: SLACK_INTRO_CHANNEL },
        { channel_id: "C999", name: "elsewhere" },
      ],
    });

    expect(await loadIntroChannelId(repos())).toBe("C123");
  });

  it("is null when the workspace has no such channel", async () => {
    dataset = new InMemoryDataset();
    expect(await loadIntroChannelId(repos())).toBeNull();
  });
});
