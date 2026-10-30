import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryProgramRepository } from "@/lib/data/programs";
import { defineProgramContract } from "@/tests/helpers/program-contract";

const members = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.test" },
] as const;

const dataset = () =>
  new InMemoryDataset({
    members: [
      { ...members[0], displayName: "Ada E.", status: "cancelled" },
      { ...members[1] },
      { ...members[2], staffRole: "staff" },
    ],
  });

let n = 0;
defineProgramContract("InMemoryProgramRepository", () => {
  const data = dataset();
  return {
    repo: () => new InMemoryProgramRepository(data),
    unique: (label) => `${label}-${++n}`,
    members,
    year: 2087,
    missingId: "prg_AAAAAAAAAAAA",
    clear: async () => {
      data.programs = [];
      data.programCohorts = [];
      data.programEnrollments = [];
    },
  };
});

describe("InMemoryProgramRepository seeding", () => {
  it("starts from typed rows and keeps them apart from the seed", async () => {
    const row = { id: "prg_AAAAAAAAAAAA", name: "Ready Writers", slug: "ready-writers", description: null, includes_membership: true, kajabi_offer_names: [], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    const data = new InMemoryDataset({ programs: [row] });
    row.name = "Changed";
    expect(await new InMemoryProgramRepository(data).names()).toEqual([{ id: "prg_AAAAAAAAAAAA", name: "Ready Writers" }]);
  });
});
