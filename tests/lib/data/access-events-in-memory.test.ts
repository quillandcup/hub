import { describe, expect, it } from "vitest";
import { InMemoryAccessEventRepository } from "@/lib/data/access-events";
import { InMemoryDataset } from "@/lib/data/in-memory";

describe("InMemoryAccessEventRepository", () => {
  it("records visits with the database's defaults for what is not given", async () => {
    const data = new InMemoryDataset();
    const repo = new InMemoryAccessEventRepository(data);

    await repo.record({ user_id: "00000000-0000-4000-8000-000000000001", path: "/dashboard", is_page: true, country: "US" });
    await repo.record({ user_id: "00000000-0000-4000-8000-000000000001", path: "/events", is_page: true });

    expect(data.accessEvents.map((e) => [e.id, e.path, e.country, e.city, e.ip_address, e.user_agent])).toEqual([
      [1, "/dashboard", "US", null, null, null],
      [2, "/events", null, null, null, null],
    ]);
  });
});
