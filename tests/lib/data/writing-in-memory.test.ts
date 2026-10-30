import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryWritingRepository } from "@/lib/data/writing";
import { defineWritingContract } from "@/tests/helpers/writing-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"] as const;
const prickleId = "prkl_AAAAAAAAAAA1";

defineWritingContract("InMemoryWritingRepository", () => {
  const data = new InMemoryDataset({
    members: [
      { id: memberIds[0], name: "Writing Member 0" },
      { id: memberIds[1], name: "Writing Member 1" },
    ],
    prickleTypes: [{ id: "ptyp_AAAAAAAAAAA1", name: "Writing Contract", normalizedName: "writing-contract", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false }],
    prickles: [{ id: prickleId, typeId: "ptyp_AAAAAAAAAAA1", hostId: memberIds[1], title: null, startTime: "2097-01-01T09:00:00Z", endTime: "2097-01-01T10:00:00Z", source: "calendar", calendarEventId: null }],
  });
  let n = 0;
  return {
    memberIds,
    prickleId,
    prickleTypeName: "Writing Contract",
    prickleHostName: "Writing Member 1",
    repo: () => new InMemoryWritingRepository(data),
    seed: async ({ projects = [], goals = [], entries = [] }) => {
      const ids: Record<string, string> = {};
      data.writingBalances = [];
      data.writingProjects =projects.map((p) => {
        ids[p.key] = `wprj_${++n}`;
        return {
          id: ids[p.key],
          member_id: memberIds[p.member],
          title: p.title,
          description: null,
          cover_asset_id: null, cover_url: null,
          external_id: null,
          phase: "drafting",
          show_on_profile: false,
          archived_at: p.archived ? "2026-06-01T00:00:00Z" : null,
          created_at: p.createdAt,
        };
      });
      data.writingGoals = goals.map((g) => ({
        id: `wgol_${++n}`,
        member_id: memberIds[g.member],
        project_id: g.project ? ids[g.project] : null,
        title: null,
        description: null,
        external_id: null,
        goal_type: "target",
        habit_period: null,
        habit_threshold: null,
        is_starred: false,
        measure: g.measure,
        show_on_profile: false,
        start_date: null,
        end_date: null,
        target_amount: null,
        archived_at: g.archived ? "2026-06-01T00:00:00Z" : null,
        created_at: "2026-01-01T00:00:00Z",
      }));
      data.writingEntries = entries.map((e) => ({
        id: `wpe_${++n}`,
        member_id: memberIds[e.member],
        project_id: ids[e.project],
        prickle_id: e.prickle ? prickleId : null,
        entry_date: e.entryDate,
        measure: e.measure,
        mode: e.mode,
        amount: e.amount,
        note: e.note ?? null,
        tags: e.tags ?? [],
        external_id: null,
        created_at: e.createdAt,
      }));
      return ids;
    },
  };
});
