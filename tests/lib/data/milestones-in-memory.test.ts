import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMilestoneRepository } from "@/lib/data/milestones";
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
    addBook: async (memberId) => {
      data.memberBooks.push({ id: `book_${String(++n).padStart(12, "A")}`, member_id: memberId, title: "A Book", published_date: "2026-01-01", cover_asset_id: null });
    },
    deleteBooks: async (memberId) => {
      for (const b of data.memberBooks) if (b.member_id === memberId) b.deleted_at = new Date().toISOString();
    },
    clear: async () => {
      data.memberMilestones = [];
      data.memberBooks = [];
    },
  };
});
