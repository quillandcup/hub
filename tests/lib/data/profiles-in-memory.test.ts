import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryProfileRepository } from "@/lib/data/profiles";
import { defineProfileContract } from "@/tests/helpers/profile-contract";

defineProfileContract("InMemoryProfileRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryProfileRepository(data),
    unique: (label) => `${label} ${++n}`,
    seed: async (users) => {
      const ids: Record<string, string> = {};
      data.userProfiles = users.map((u, i) => {
        ids[u.key] = `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
        return { id: ids[u.key], email: u.email, role: u.role ?? "member", timezone_preference: u.timezone ?? null, secondary_timezone: u.secondary ?? null };
      });
      return ids;
    },
  };
});
