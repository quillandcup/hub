import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMilestoneRepository } from "@/lib/data/milestones";
import { InMemoryWritingRepository } from "@/lib/data/writing";
import { defineMilestonesContract } from "@/tests/helpers/milestones-contract";

const ADA = "mbr_AAAAAAAAAAA1";
const BO = "mbr_AAAAAAAAAAA2";
let n = 0;

defineMilestonesContract("InMemoryMilestoneRepository", () => {
  const data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Example" },
      { id: BO, name: "Bo Example" },
    ],
  });
  return {
    repo: () => new InMemoryMilestoneRepository(data),
    members: [ADA, BO],
    missingMemberId: "mbr_ZZZZZZZZZZZZ",
    staffUserId: "11111111-1111-4111-8111-111111111111",
    addBook: async (memberId, projectId, publishedDate = "2026-01-01") => {
      const id = `book_${String(++n).padStart(12, "A")}`;
      data.memberBooks.push({ id, member_id: memberId, title: "A Book", published_date: publishedDate, cover_asset_id: null, project_id: projectId ?? null });
      return id;
    },
    deleteBooks: async (memberId) => {
      for (const b of data.memberBooks) if (b.member_id === memberId) b.deleted_at = new Date().toISOString();
    },
    addProject: (memberId) => new InMemoryWritingRepository(data).createProject(memberId, "A Fake Novel", "drafting"),
    setProjectVisibility: async (projectId, visibility) => {
      const project = data.writingProjects.find((p) => p.id === projectId);
      if (project) Object.assign(project, { visibility, show_on_profile: visibility !== "private" });
    },
    clear: async () => {
      data.writingProjects = [];
      data.memberMilestones = [];
      data.memberBookPhotos = [];
      data.memberMilestoneSnoozes = [];
      data.memberBooks = [];
    },
  };
});

describe("InMemoryMilestoneRepository.addOwn", () => {
  // The Supabase contract runs as the service role, which has no row-level security, so this rule is tested on the twin
  // here and on the real policy in supabase/tests/database/member_milestones.test.sql.
  it("refuses a project that is not the member's, as the database policy does", async () => {
    const data = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example" }, { id: BO, name: "Bo Example" }] });
    const otherProject = await new InMemoryWritingRepository(data).createProject(BO, "A Fake Novel", "drafting");
    const repo = new InMemoryMilestoneRepository(data);
    const answer = { status: "confirmed" as const, achievedOn: null, achievedPrecision: "day" as const, storyBefore: null, storyAfter: null, consent_profile: false, consent_homepage: false, consent_testimonial: false };
    await expect(repo.addOwn({ memberId: ADA, kind: "the_end", answer, work: { projectId: otherProject, bookId: null, title: null }, createdBy: "11111111-1111-4111-8111-111111111111" }, new Date())).rejects.toThrow();
    expect(await repo.ofMember(ADA)).toEqual([]);
  });
});

describe("InMemoryMilestoneRepository.recordNotForThisWork", () => {
  it("refuses a project that is not the member's and a member that does not exist, as the database does", async () => {
    const data = new InMemoryDataset({ members: [{ id: ADA, name: "Ada Example" }, { id: BO, name: "Bo Example" }] });
    const otherProject = await new InMemoryWritingRepository(data).createProject(BO, "A Fake Novel", "drafting");
    const repo = new InMemoryMilestoneRepository(data);
    const createdBy = "11111111-1111-4111-8111-111111111111";
    await expect(repo.recordNotForThisWork({ memberId: ADA, kind: "the_end", projectId: otherProject, createdBy }, new Date())).rejects.toThrow(/row-level security/);
    await expect(repo.recordNotForThisWork({ memberId: "mbr_ZZZZZZZZZZZZ", kind: "the_end", projectId: otherProject, createdBy }, new Date())).rejects.toThrow(/foreign key/);
    expect(data.memberMilestones).toEqual([]);
  });
});
