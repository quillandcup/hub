import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMemberRepository, SupabaseMemberRepository } from "@/lib/data/members";

describe("deleteDerivedStats", () => {
  it("drops only that member's metrics and engagement rows", async () => {
    const data = new InMemoryDataset({
      memberMetrics: [{ member_id: "mbr_AAAAAAAAAAA1" }, { member_id: "mbr_AAAAAAAAAAA2" }],
      memberEngagement: [{ member_id: "mbr_AAAAAAAAAAA1" }, { member_id: "mbr_AAAAAAAAAAA2" }],
    });

    await new InMemoryMemberRepository(data).deleteDerivedStats("mbr_AAAAAAAAAAA1");

    expect(data.memberMetrics).toEqual([{ member_id: "mbr_AAAAAAAAAAA2" }]);
    expect(data.memberEngagement).toEqual([{ member_id: "mbr_AAAAAAAAAAA2" }]);
  });

  it("deletes from both tables and throws the database's error when either fails", async () => {
    const tables: string[] = [];
    const client = (failing: string) =>
      ({
        from: (table: string) => {
          tables.push(table);
          return { delete: () => ({ eq: async () => ({ error: table === failing ? { message: `${table} is down` } : null }) }) };
        },
      }) as unknown as Db;

    await expect(new SupabaseMemberRepository(client("member_engagement")).deleteDerivedStats("mbr_AAAAAAAAAAA1")).rejects.toThrow("member_engagement is down");
    expect(tables.sort()).toEqual(["member_engagement", "member_metrics"]);
    await expect(new SupabaseMemberRepository(client("member_metrics")).deleteDerivedStats("mbr_AAAAAAAAAAA1")).rejects.toThrow("member_metrics is down");
  });
});
