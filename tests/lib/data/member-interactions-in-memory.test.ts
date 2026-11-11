import { InMemoryMemberInteractionRepository } from "@/lib/data/member-interactions";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineMemberInteractionContract } from "@/tests/helpers/member-interactions-contract";

const memberIds = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA3", "mbr_AAAAAAAAAAA4"] as const;

defineMemberInteractionContract("InMemoryMemberInteractionRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    memberIds,
    repo: () => new InMemoryMemberInteractionRepository(data),
    add: async (rows) => {
      for (const r of rows) {
        data.memberInteractions.push({
          id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
          member_a: memberIds[r.a],
          member_b: memberIds[r.b],
          kind: r.kind ?? "dm",
          channel_id: null,
          message_id: null,
          occurred_at: r.at,
          visibility: "private",
        });
      }
    },
    clear: async () => {
      data.memberInteractions = [];
    },
  };
});
