import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMemberDirectoryRepository } from "@/lib/data/member-directory";
import { defineMemberDirectoryContract } from "@/tests/helpers/member-directory-contract";

defineMemberDirectoryContract("InMemoryMemberDirectoryRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryMemberDirectoryRepository(data),
    unique: (label) => `${label} ${++n}`,
    seed: async (people) => {
      const ids: Record<string, string> = {};
      data.members = people.map((p, i) => {
        ids[p.key] = `mbr_${String(i).padStart(12, "A")}`;
        return { id: ids[p.key], name: p.name, displayName: p.displayName ?? null, bio: p.bio ?? null, photoUrl: p.photoUrl ?? null };
      });
      return ids;
    },
  };
});
