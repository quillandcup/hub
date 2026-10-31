import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { InMemoryAdminWorkQueueRepository } from "@/lib/data/admin-work";
import { InMemoryAwardRepository } from "@/lib/data/awards";
import { InMemoryMemberProfileRepository } from "@/lib/data/member-profile";
import { InMemoryMentorshipRepository } from "@/lib/data/mentorship";
import { InMemoryOutreachRepository } from "@/lib/data/outreach";
import { InMemoryStaffRepository } from "@/lib/data/staff";
import { defineAdminWorkContract } from "@/tests/helpers/admin-work-contract";
import { defineAwardsContract } from "@/tests/helpers/awards-contract";
import { defineMemberProfileContract } from "@/tests/helpers/member-profile-contract";
import { defineMentorshipContract } from "@/tests/helpers/mentorship-contract";
import { defineOutreachContract } from "@/tests/helpers/outreach-contract";
import { defineStaffContract } from "@/tests/helpers/staff-contract";

const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
const USER_ID = "11111111-1111-4111-8111-111111111111";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E.", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" },
  { id: "mbr_AAAAAAAAAAA4", name: "Dee Example", email: "dee@example.test" },
];
const dataset = () => new InMemoryDataset({ members: members.map((m) => ({ ...m })) });

defineStaffContract("InMemoryStaffRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryStaffRepository(data),
    members,
    seed: async (staff) => {
      data.staff = staff.map((s, i) => ({
        id: crypto.randomUUID(),
        name: s.name,
        email: `staff-${i}@example.test`,
        role: s.role,
        hire_date: s.hireDate ?? null,
        member_id: null,
        notes: null,
        created_at: null,
        updated_at: null,
      }));
      return data.staff.map((s) => s.id);
    },
  };
});

defineMentorshipContract("InMemoryMentorshipRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryMentorshipRepository(data),
    members,
    missingId: MISSING_UUID,
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    clear: async () => {
      data.mentorships = [];
      data.bigSisterVolunteers = [];
    },
  };
});

defineMemberProfileContract("InMemoryMemberProfileRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryMemberProfileRepository(data),
    members,
    userId: USER_ID,
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    seedSlackConnection: async (memberId, slackUserId, options = {}) => {
      data.slackConnections.push({
        member_id: memberId,
        slack_user_id: slackUserId,
        team_id: null,
        scopes: options.scopes ?? [],
        connected_at: "2026-01-01T00:00:00Z",
        revoked_at: options.revoked ? "2026-02-01T00:00:00Z" : null,
        expires_at: null,
        read_pulled_at: null,
        access_secret_id: null,
        refresh_secret_id: null,
      });
    },
    clear: async () => {
      data.askMeAbout = [];
      data.memberNotes = [];
      data.rosterOptOuts = [];
      data.onboarding = [];
      data.slackConnections = [];
    },
  };
});

defineAwardsContract("InMemoryAwardRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryAwardRepository(data),
    members,
    missingId: MISSING_UUID,
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    clear: async () => {
      data.awards = [];
    },
  };
});

defineOutreachContract("InMemoryOutreachRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryOutreachRepository(data),
    members,
    userId: USER_ID,
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    clear: async () => {
      data.outreachLeads = [];
      data.outreachTouches = [];
    },
  };
});

defineAdminWorkContract("InMemoryAdminWorkQueueRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryAdminWorkQueueRepository(data),
    members,
    userId: USER_ID,
    missingId: MISSING_UUID,
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    run: "twin",
    clear: async () => {
      data.workQueueCompletions = [];
      data.dismissedDuplicateGroups = [];
      data.feedback = [];
    },
  };
});

describe("InMemoryMentorshipRepository functions", () => {
  const match = { id: "m1", mentor_member_id: members[0].id, new_member_id: members[1].id, started_on: "2026-10-01", trial_ends_on: "2026-10-08", kind: "trial", status: "matched", outcome_note: "private", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  const seeded = () =>
    createInMemoryRepos(
      new InMemoryDataset({
        members: [
          { ...members[0], status: "active", firstJoinedAt: "2020-01-01" },
          { ...members[1], status: "cancelled", firstJoinedAt: "2026-10-01", mostRecentJoinedAt: "2026-10-01", photoUrl: "https://example.test/bo.png" },
          { ...members[2] },
        ],
        mentorships: [match, { ...match, id: "m2", mentor_member_id: members[2].id, new_member_id: members[0].id, started_on: "2026-09-01", status: "reassigned" }],
      }),
    ).mentorship;

  it("shows a big sister her mentee with the membership facts and the note, and a new member only the big sister", async () => {
    const repo = seeded();
    const [mine] = await repo.myMentorships(members[0].id);
    expect(mine).toMatchObject({ mentorship_id: "m1", viewer_role: "big_sister", other_member_id: members[1].id, other_name: "Bo Example", other_photo_url: "https://example.test/bo.png", outcome_note: "private", other_status: "cancelled", other_first_joined_at: "2026-10-01", other_most_recent_joined_at: "2026-10-01" });

    const [theirs] = await repo.myMentorships(members[1].id);
    expect(theirs).toMatchObject({ viewer_role: "new_member", other_member_id: members[0].id, outcome_note: null, other_status: null, other_first_joined_at: null, other_most_recent_joined_at: null });
    expect(await repo.myMentorships(members[2].id)).toEqual([]);
  });

  it("lets a note be written on a live match only, trimming it and clearing a blank one", async () => {
    const repo = seeded();
    expect(await repo.setNote("m1", "  Went quiet  ")).toBe(true);
    expect((await repo.listWithMembers()).find((m) => m.id === "m1")?.outcome_note).toBe("Went quiet");
    expect(await repo.setNote("m1", "   ")).toBe(true);
    expect((await repo.listWithMembers()).find((m) => m.id === "m1")?.outcome_note).toBeNull();
    expect(await repo.setNote("m2", "reassigned")).toBe(false);
    await expect(repo.setNote("m1", "x".repeat(1001))).rejects.toThrow("note too long");
  });
});

describe("people repositories seeding", () => {
  it("starts from typed rows and keeps them apart from the seed, through createInMemoryRepos", async () => {
    const topics = ["Poetry"];
    const data = new InMemoryDataset({
      members: [{ ...members[0], kajabiTags: ["Ideal Hedgie"], status: "lead" }],
      askMeAbout: [{ member_id: members[0].id, topics, updated_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
      onboarding: [{ member_id: members[0].id, marked_steps: ["names"], dismissed_at: null, completed_at: null, acknowledged_steps: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
      slackConnections: [{ member_id: members[0].id, slack_user_id: "U1", team_id: null, scopes: ["a"], connected_at: "2026-01-01T00:00:00Z", revoked_at: null, expires_at: null, read_pulled_at: null, access_secret_id: null, refresh_secret_id: null }],
    });
    topics.push("changed after seeding");
    const repos = createInMemoryRepos(data);
    expect(await repos.memberProfile.askMeAbout(members[0].id)).toEqual(["Poetry"]);
    expect((await repos.memberProfile.onboardingOf(members[0].id))?.marked_steps).toEqual(["names"]);
    expect((await repos.memberProfile.slackConnectionOf(members[0].id))?.scopes).toEqual(["a"]);
    expect(await repos.members.withKajabiTag("Ideal Hedgie", ["lead"])).toHaveLength(1);
  });
});
