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

  it("gives each of one user's sessions its latest located place, and nothing for other users or unlocated sessions", async () => {
    const data = new InMemoryDataset();
    const repo = new InMemoryAccessEventRepository(data);
    const me = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    const s1 = "10000000-0000-4000-8000-000000000001";
    const s2 = "10000000-0000-4000-8000-000000000002";
    const s3 = "10000000-0000-4000-8000-000000000003";
    const at = (created_at: string) => ({ created_at, path: "/x", is_page: true });

    await repo.record({ user_id: me, session_id: s1, city: "Old City", country: "US", ...at("2026-01-01T00:00:00Z") });
    await repo.record({ user_id: me, session_id: s1, city: "Heredia", country: "CR", ...at("2026-01-02T00:00:00Z") });
    await repo.record({ user_id: me, session_id: s1, ...at("2026-01-03T00:00:00Z") });
    await repo.record({ user_id: me, session_id: s2, ...at("2026-01-02T00:00:00Z") });
    await repo.record({ user_id: other, session_id: s3, city: "Elsewhere", country: "FR", ...at("2026-01-02T00:00:00Z") });

    const places = await repo.placesBySession(me, [s1, s2, s3]);
    expect([...places.entries()]).toEqual([[s1, { city: "Heredia", country: "CR" }]]);
  });
});
