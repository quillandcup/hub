import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryPrickleScheduleRepository } from "@/lib/data/prickle-schedules";
import { definePrickleScheduleContract, type SeedSchedule } from "@/tests/helpers/prickle-schedule-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;
const typeIds = ["ptyp_AAAAAAAAAAA1", "ptyp_AAAAAAAAAAA2"] as const;
const months = ["2097-03-01", "2097-04-01", "2097-05-01"] as const;
const type = (id: string, name: string) => ({ id, name, normalizedName: name.toLowerCase(), purpose: "writing", requiresHost: true, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false });

definePrickleScheduleContract("InMemoryPrickleScheduleRepository", () => {
  const data = new InMemoryDataset({
    members: [
      { id: memberIds[0], name: "Ada Example", displayName: "Ada E." },
      { id: memberIds[1], name: "Bo Example" },
    ],
    prickleTypes: [type(typeIds[0], "Sprint A"), type(typeIds[1], "Sprint B")],
  });
  return {
    memberIds,
    typeIds,
    typeNames: ["Sprint A", "Sprint B"],
    months,
    missingId: "psch_AAAAAAAAAAAA",
    repo: () => new InMemoryPrickleScheduleRepository(data),
    stored: async () => data.prickleSchedules.map((row) => ({ ...row })),
    seed: async (rows: SeedSchedule[]) => {
      const ids: Record<string, string> = {};
      data.prickleSchedules = rows.map((r, i) => {
        ids[r.key] = `psch_${String(i + 1).padStart(12, "A")}`;
        const created = new Date(Date.UTC(2090, 0, 1, 0, 0, r.created)).toISOString();
        return {
          id: ids[r.key],
          host_id: memberIds[r.host],
          type_id: typeIds[r.type ?? 0],
          month: months[r.month],
          recurrence_type: r.recurrence ?? "weekly",
          day_of_week: r.recurrence === "one_off" ? null : 2,
          recurrence_anchor_date: null,
          week_of_month: null,
          event_date: r.recurrence === "one_off" ? `${months[r.month].slice(0, 8)}15` : null,
          start_time_local: "19:00",
          timezone: "America/New_York",
          status: r.status ?? "proposed",
          confirmed_by: null,
          confirmed_at: null,
          carried_forward_from: null,
          notes: null,
          deleted_at: r.deleted ? "2099-01-01T00:00:00Z" : null,
          deleted_by: null,
          updated_by: null,
          updated_at: created,
          created_at: created,
        };
      });
      return ids;
    },
  };
});
