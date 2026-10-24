import { InMemoryAttendanceRepository } from "@/lib/data/attendance";
import { defineAttendanceContract, type SeedRecord } from "@/tests/helpers/attendance-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA3"] as const;
const prickleIds = ["prkl_AAAAAAAAAAA1", "prkl_AAAAAAAAAAA2", "prkl_AAAAAAAAAAA3"] as const;

defineAttendanceContract("InMemoryAttendanceRepository", () => {
  let repo = new InMemoryAttendanceRepository();
  return {
    memberIds,
    prickleIds,
    repo: () => repo,
    seed: async (records: SeedRecord[]) => {
      repo = new InMemoryAttendanceRepository(
        records.map((r, i) => ({
          id: `att_${i}`,
          memberId: memberIds[r.member],
          prickleId: prickleIds[r.prickle],
          joinTime: r.join,
          leaveTime: r.leave ?? r.join,
        })),
      );
    },
  };
});
