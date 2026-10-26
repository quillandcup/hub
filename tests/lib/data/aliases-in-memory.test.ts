import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryAliasRepository } from "@/lib/data/aliases";
import { defineAliasContract } from "@/tests/helpers/alias-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;

defineAliasContract("InMemoryAliasRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    memberIds,
    memberEmails: ["ada@example.test", "fern@example.test"],
    repo: () => new InMemoryAliasRepository(data),
    unique: (label) => `${label} ${++n}`,
    seed: async ({ names = [], emails = [] }) => {
      data.nameAliases = names.map((a, i) => ({ id: `nal_${i}`, member_id: memberIds[a.member], alias: a.alias, source: a.source, active: a.active ?? true }));
      data.emailAliases = emails.map((e, i) => ({ id: `eal_${i}`, memberId: memberIds[e.member], alias_email: e.email, canonical_email: e.member === 0 ? "ada@example.test" : "fern@example.test", active: e.active ?? true }));
    },
  };
});
