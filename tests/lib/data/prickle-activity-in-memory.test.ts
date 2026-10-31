import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryPrickleActivityRepository } from "@/lib/data/prickle-activity";
import type { Prickle, PrickleType } from "@/lib/data/prickles";
import { definePrickleActivityContract } from "@/tests/helpers/prickle-activity-contract";

const members: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];
const type = (n: number, name: string): PrickleType => ({
  id: `ptyp_AAAAAAAAAAA${n}`,
  name,
  normalizedName: name.toLowerCase().replace(/\s+/g, "-"),
  purpose: "writing",
  requiresHost: false,
  soloTaskFriendly: false,
  listedInEvents: false,
  announcedPublicly: false,
  guestsAllowed: false,
});
const types = [type(1, "Sprint Writing"), type(2, "Progress Prickle")] as const;
const prickle = (n: number, typeId: string, hostId: string | null): Prickle => ({
  id: `prkl_AAAAAAAAAAA${n}`,
  typeId,
  hostId,
  title: null,
  startTime: new Date(Date.UTC(2097, 0, 1, 9 + n)).toISOString(),
  endTime: new Date(Date.UTC(2097, 0, 1, 10 + n)).toISOString(),
  source: "calendar",
  calendarEventId: null,
});

definePrickleActivityContract("InMemoryPrickleActivityRepository", () => {
  const prickles = [prickle(1, types[0].id, members[1]), prickle(2, types[1].id, null), prickle(3, types[0].id, null)] as const;
  const dataset = new InMemoryDataset({
    members: members.map((id, i) => ({ id, name: `Member ${i + 1} Example` })),
    prickleTypes: [...types],
    prickles: [...prickles],
  });
  return {
    repo: () => new InMemoryPrickleActivityRepository(dataset),
    members,
    types: [
      { id: types[0].id, name: types[0].name },
      { id: types[1].id, name: types[1].name },
    ],
    prickles: [
      { id: prickles[0].id, typeId: types[0].id, hostId: members[1] },
      { id: prickles[1].id, typeId: types[1].id, hostId: null },
      { id: prickles[2].id, typeId: types[0].id, hostId: null },
    ],
    reset: async () => {},
  };
});
