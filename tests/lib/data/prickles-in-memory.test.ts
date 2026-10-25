import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryPrickleRepository, type Prickle, type PrickleType } from "@/lib/data/prickles";
import { definePrickleContract, type PrickleSeed } from "@/tests/helpers/prickle-contract";

const types = [
  { id: "ptyp_AAAAAAAAAAA1", name: "Contract Sprint", normalizedName: "contract-sprint", purpose: "writing", requiresHost: true, soloTaskFriendly: false },
  { id: "ptyp_AAAAAAAAAAA2", name: "Contract Chat", normalizedName: "contract-chat", purpose: "social", requiresHost: false, soloTaskFriendly: true },
] as const satisfies readonly PrickleType[];
const hosts = [
  { id: "mbr_AAAAAAAAAAA1", name: "Ada Example" },
  { id: "mbr_AAAAAAAAAAA2", name: "Fern Example" },
] as const;

definePrickleContract("InMemoryPrickleRepository", () => {
  let data = new InMemoryDataset();
  return {
    types,
    hosts,
    repo: () => new InMemoryPrickleRepository(data),
    adopt: () => {},
    seed: async (seeds: PrickleSeed[]) => {
      const prickles: Prickle[] = seeds.map((s, i) => ({
        id: `prkl_${String(i).padStart(12, "A")}`,
        typeId: s.type === undefined ? null : types[s.type].id,
        hostId: s.host === undefined ? null : hosts[s.host].id,
        title: null,
        startTime: s.start,
        endTime: s.end ?? s.start,
        source: s.source ?? "calendar",
        calendarEventId: null,
      }));
      data = new InMemoryDataset({ members: [...hosts], prickleTypes: [...types], prickles });
      return prickles.map((p) => p.id);
    },
  };
});
