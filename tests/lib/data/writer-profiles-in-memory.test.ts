import { InMemoryAliasRepository } from "@/lib/data/aliases";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryWriterProfileRepository } from "@/lib/data/writer-profiles";
import { defineWriterProfileContract } from "@/tests/helpers/writer-profile-contract";

let n = 0;
const ADA = "mbr_AAAAAAAAAAA1";
const GRACE = "mbr_AAAAAAAAAAA2";

defineWriterProfileContract("InMemoryWriterProfileRepository", () => {
  const data = new InMemoryDataset({
    members: [
      { id: ADA, name: "Ada Legalname", displayName: "Ada Example" },
      { id: GRACE, name: "Grace Example" },
    ],
  });
  const member = (id: string) => data.members.find((m) => m.id === id)!;
  return {
    profiles: () => new InMemoryWriterProfileRepository(data),
    aliases: () => new InMemoryAliasRepository(data),
    members: [ADA, GRACE],
    unique: (label) => `${label}-${++n}`,
    reset: async () => {
      data.writerProfiles = [];
      data.writerProfileHandles = [];
      data.nameAliases = [];
    },
    setDisplayName: async (id, name) => {
      member(id).displayName = name;
    },
    setPhoto: async (id, url) => {
      member(id).photoUrl = url;
    },
    addAlias: async (memberId, alias, source, options = {}) => {
      const id = `nalias_${String(++n).padStart(12, "A")}`;
      data.nameAliases.push({ id, member_id: memberId, alias, source, active: options.active ?? true, isPublic: options.isPublic ?? false });
      return id;
    },
    changeAlias: async (id, changes) => {
      const row = data.nameAliases.find((a) => a.id === id)!;
      if (changes.isPublic !== undefined) row.isPublic = changes.isPublic;
      if (changes.active !== undefined) row.active = changes.active;
    },
  };
});
