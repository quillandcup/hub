import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMemberDirectoryRepository } from "@/lib/data/member-directory";
import { InMemoryMemberStatusRepository } from "@/lib/data/member-status-overrides";
import { defineMemberDirectoryContract } from "@/tests/helpers/member-directory-contract";

defineMemberDirectoryContract("InMemoryMemberDirectoryRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryMemberDirectoryRepository(data),
    setLevel: async (memberId, item, level) => {
      await new InMemoryMemberStatusRepository(data).saveProfileVisibility(memberId, item, level, null);
    },
    addAlias: async (memberId, alias, active) => {
      data.nameAliases.push({ id: `alias_${++n}`, member_id: memberId, alias, source: "zoom", active });
    },
    unique: (label) => `${label} ${++n}`,
    seed: async (people) => {
      const ids: Record<string, string> = {};
      data.members = people.map((p, i) => {
        ids[p.key] = `mbr_${String(i).padStart(12, "A")}`;
        return { id: ids[p.key], name: p.name, displayName: p.displayName ?? null, bio: p.bio ?? null, photoUrl: p.photoUrl ?? null, instagramUrl: p.instagramUrl ?? null };
      });
      return ids;
    },
  };
});
