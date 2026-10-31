import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMemberStatusRepository } from "@/lib/data/member-status-overrides";
import { createInMemoryRepos } from "@/lib/data/repos";
import { defineMemberStatusContract } from "@/tests/helpers/member-status-contract";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" },
] as const;

const dataset = () => new InMemoryDataset({ members: [{ ...members[0], displayName: "Ada E." }, { ...members[1] }, { ...members[2] }] });

defineMemberStatusContract("InMemoryMemberStatusRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryMemberStatusRepository(data),
    members,
    userId: "11111111-1111-4111-8111-111111111111",
    missingId: "00000000-0000-4000-8000-000000000000",
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    seedJoinDate: async (memberId, firstJoinedAt) => {
      data.memberJoinDateOverrides.push({ member_id: memberId, first_joined_at: firstJoinedAt, reason: null, created_at: "2026-01-01T00:00:00Z" });
    },
    clear: async () => {
      data.memberHiatuses = [];
      data.memberStatusOverrides = [];
      data.memberJoinDateOverrides = [];
      data.memberProfileOverrides = [];
    },
  };
});

describe("InMemoryMemberStatusRepository seeding", () => {
  it("starts from typed rows and keeps them apart from the seed, through createInMemoryRepos", async () => {
    const hiatus = { id: "h1", member_id: members[0].id, start_date: "2026-01-01", end_date: null, reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-01-01T00:00:00Z" };
    const data = new InMemoryDataset({
      members: [{ ...members[0] }],
      memberHiatuses: [hiatus],
      memberStatusOverrides: [{ id: "o1", member_id: members[0].id, override_type: "gift", reason: "r", notes: null, starts_at: "2026-01-01T00:00:00Z", expires_at: null, created_at: "2026-01-01T00:00:00Z", created_by: null, updated_at: "2026-01-01T00:00:00Z" }],
      memberJoinDateOverrides: [{ member_id: members[0].id, first_joined_at: "2020-01-01T00:00:00Z", reason: null, created_at: "2026-01-01T00:00:00Z" }],
      memberProfileOverrides: [{ member_id: members[0].id, bio: "Hi", instagram_url: null, facebook_url: null, twitter_url: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", updated_by: null }],
    });
    hiatus.start_date = "1999-01-01";
    const repo = createInMemoryRepos(data).memberStatus;
    expect((await repo.hiatusesOf(members[0].id))[0].start_date).toBe("2026-01-01");
    expect(await repo.statusOverridesOf(members[0].id)).toHaveLength(1);
    expect(await repo.joinDateOverrides()).toHaveLength(1);
    expect(await repo.profileOverrideOf(members[0].id)).toMatchObject({ bio: "Hi" });
  });
});
