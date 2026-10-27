import { InMemoryAttendanceRepository } from "@/lib/data/attendance";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { prickleDetail, type Prickle, type PrickleType } from "@/lib/data/prickles";
import { defineAttendanceContract, type ContractMember, type SeedRecord } from "@/tests/helpers/attendance-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA3"] as const;
const prickleIds = ["prkl_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA2", "prkl_AAAAAAAAAAA3"] as const;
const members = [
  { id: memberIds[0], name: "Ada Example", displayName: "Penny Quill", email: "ada@example.test" },
  { id: memberIds[1], name: "Fern Example", displayName: null, email: "fern@example.test" },
  { id: memberIds[2], name: "Gale Example", displayName: null, email: "gale@example.test" },
] as const satisfies readonly ContractMember[];
const types = [
  { id: "ptyp_AAAAAAAAAAA1", name: "Sprint Writing", normalizedName: "sprint-writing", purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
  { id: "ptyp_AAAAAAAAAAA2", name: "Social Hour", normalizedName: "social-hour", purpose: "social", requiresHost: false, soloTaskFriendly: true, listedInEvents: false, announcedPublicly: false, guestsAllowed: false },
] as const satisfies readonly PrickleType[];
const prickle = (i: number, typeId: string, hostId: string | null): Prickle => ({
  id: prickleIds[i],
  typeId,
  hostId,
  title: null,
  startTime: new Date(Date.UTC(2097, 0, 1, 9 + i)).toISOString(),
  endTime: new Date(Date.UTC(2097, 0, 1, 10 + i)).toISOString(),
  source: "calendar",
  calendarEventId: null,
});
const prickles = [prickle(0, types[0].id, memberIds[2]), prickle(1, types[1].id, null), prickle(2, types[0].id, null)] as const;

const dataset = (attendance: InMemoryDataset["attendance"]) =>
  new InMemoryDataset({ members: [...members], prickleTypes: [...types], prickles: [...prickles], attendance });

defineAttendanceContract("InMemoryAttendanceRepository", () => {
  let repo = new InMemoryAttendanceRepository(dataset([]));
  return {
    memberIds,
    prickleIds,
    members,
    prickles: [
      prickleDetail(dataset([]), prickles[0]),
      prickleDetail(dataset([]), prickles[1]),
      prickleDetail(dataset([]), prickles[2]),
    ],
    repo: () => repo,
    seed: async (records: SeedRecord[]) => {
      repo = new InMemoryAttendanceRepository(
        dataset(
          records.map((r, i) => ({
            id: `att_${String(i).padStart(5, "0")}`,
            memberId: memberIds[r.member],
            prickleId: prickleIds[r.prickle],
            joinTime: r.join,
            leaveTime: r.leave ?? r.join,
          })),
        ),
      );
    },
  };
});
