import { InMemoryFeatureFlagRepository } from "@/lib/data/feature-flags";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemorySegmentRepository } from "@/lib/data/segments";
import { defineFeatureFlagContract } from "@/tests/helpers/feature-flag-contract";
import { defineSegmentContract, type SegmentContractContext } from "@/tests/helpers/segment-contract";

let n = 0;

function setup(): SegmentContractContext {
  const data = new InMemoryDataset();
  return {
    segments: () => new InMemorySegmentRepository(data),
    flags: () => new InMemoryFeatureFlagRepository(data),
    unique: (label) => `${label} ${++n}`,
    seed: async (count) => {
      const memberIds = Array.from({ length: count }, () => `mbr_${String(++n).padStart(12, "A")}`);
      for (const id of memberIds) data.members.push({ id, name: `Member ${id}` });
      return { memberIds, userId: crypto.randomUUID() };
    },
  };
}

defineSegmentContract("InMemorySegmentRepository", setup);
defineFeatureFlagContract("InMemoryFeatureFlagRepository", setup);
