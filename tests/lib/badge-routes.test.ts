import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";

// The badge admin routes read and write badge types, levels and awards through the badge
// repository (in memory here). The event-sync RPC they call afterwards goes through the fake client.

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));
const rpc = vi.fn(async () => ({ error: null }));
let auth: { user: { id: string } | null; forbidden?: boolean } = { user: { id: "admin-user" } };
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => (auth.user ? { ...auth, supabase: { rpc } } : { user: null }),
}));

import { POST as createType } from "@/app/api/badge-types/create/route";
import { PATCH as updateType } from "@/app/api/badge-types/[id]/update/route";
import { DELETE as deleteType } from "@/app/api/badge-types/[id]/route";
import { POST as award } from "@/app/api/member-badges/award/route";
import { DELETE as revoke } from "@/app/api/member-badges/[id]/route";

const json = (body: unknown) => new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const type = (id: string, over: object = {}) => ({
  id, key: id, name: id.toUpperCase(), description: null, icon: "🏅", category: "community", has_levels: false, is_automatic: false, program_id: null, event_id: null, ...over,
});

beforeEach(() => {
  dataset = new InMemoryDataset(eventSeed([{ id: "evt-1", title: "Spring", slug: "spring" }]));
  auth = { user: { id: "admin-user" } };
  rpc.mockClear();
});

describe("POST /api/badge-types/create", () => {
  const body = { name: "Kind Words!", description: " Warm ", icon: "💛", category: "community" };

  it("creates a badge type keyed from its name, with levels when it has them", async () => {
    const res = await createType(json({ ...body, hasLevels: true, levels: [{ level: 1, name: "One", threshold: 3 }, { level: 2, name: "Two" }] }));

    expect(res.status).toBe(201);
    const { badgeType } = await res.json();
    expect(badgeType).toMatchObject({ key: "kind_words", name: "Kind Words!", description: "Warm", icon: "💛", has_levels: true, is_automatic: false });
    expect(dataset.badgeLevels.map((l) => [l.level, l.name, l.threshold])).toEqual([[1, "One", 3], [2, "Two", null]]);
  });

  it("makes a program-linked badge automatic, and syncs a linked event's awards", async () => {
    await createType(json({ ...body, name: "Alumni", programId: "prog-1" }));
    await createType(json({ ...body, name: "Retreat", eventId: "evt-1" }));

    expect(dataset.badgeTypes.find((t) => t.key === "alumni")).toMatchObject({ is_automatic: true, program_id: "prog-1" });
    expect(rpc).toHaveBeenCalledWith("sync_event_badge_awards", { p_event_id: "evt-1" });
  });

  it("refuses a repeated name, an event that has a badge, bad input, and non-admins", async () => {
    await createType(json({ ...body, eventId: "evt-1" }));

    expect((await createType(json(body))).status).toBe(409); // same key
    expect((await createType(json({ ...body, name: "Other", eventId: "evt-1" }))).status).toBe(409); // event taken
    expect((await createType(json({ ...body, name: "  " }))).status).toBe(400);
    expect((await createType(json({ ...body, name: "Bad", category: "nope" }))).status).toBe(400);
    expect((await createType(json({ ...body, name: "Lev", hasLevels: true }))).status).toBe(400);
    auth = { user: null };
    expect((await createType(json(body))).status).toBe(401);
    auth = { user: { id: "u" }, forbidden: true };
    expect((await createType(json(body))).status).toBe(403);
  });
});

describe("PATCH /api/badge-types/[id]/update", () => {
  const patch = { name: "Renamed", description: "", icon: "", category: "special" };

  it("renames a badge type, defaults its icon and replaces its levels", async () => {
    dataset = new InMemoryDataset({ badgeTypes: [type("a", { has_levels: true })], badgeLevels: [{ id: "l1", badge_type_id: "a", level: 1, name: "Old", threshold: 1 }] });

    const res = await updateType(json({ ...patch, hasLevels: true, levels: [{ level: 1, name: "New", threshold: 2 }] }), params("a"));

    expect(res.status).toBe(200);
    expect((await res.json()).badgeType).toMatchObject({ name: "Renamed", icon: "🏅", category: "special", description: null });
    expect(dataset.badgeLevels.map((l) => l.name)).toEqual(["New"]);
  });

  it("flips automatic only when a program is added or removed", async () => {
    dataset = new InMemoryDataset({ badgeTypes: [type("manual"), type("coded", { is_automatic: true }), type("linked", { is_automatic: true, program_id: "prog-1" })] });

    await updateType(json({ ...patch, programId: "prog-2" }), params("manual"));
    await updateType(json({ ...patch }), params("coded")); // code-driven automation is left alone
    await updateType(json({ ...patch }), params("linked")); // its program removed

    const flag = (id: string) => dataset.badgeTypes.find((t) => t.id === id)!.is_automatic;
    expect([flag("manual"), flag("coded"), flag("linked")]).toEqual([true, true, false]);
  });

  it("answers 404 for a badge type that isn't there and 409 for an event another badge has", async () => {
    dataset = new InMemoryDataset({ badgeTypes: [type("a"), type("b", { event_id: "evt-1" })] });

    expect((await updateType(json(patch), params("missing"))).status).toBe(404);
    expect((await updateType(json({ ...patch, eventId: "evt-1" }), params("a"))).status).toBe(409);
    expect((await updateType(json({ ...patch, name: "" }), params("a"))).status).toBe(400);
    expect((await updateType(json({ ...patch, eventId: "evt-2" }), params("a"))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("sync_event_badge_awards", { p_event_id: "evt-2" });
  });
});

describe("DELETE /api/badge-types/[id]", () => {
  it("deletes a manual badge type, and refuses an automatic or missing one", async () => {
    dataset = new InMemoryDataset({ badgeTypes: [type("manual"), type("coded", { is_automatic: true })] });
    const call = (id: string) => deleteType(json({}), params(id));

    expect((await call("manual")).status).toBe(200);
    expect((await call("coded")).status).toBe(400);
    expect((await call("missing")).status).toBe(404);
    expect(dataset.badgeTypes.map((t) => t.id)).toEqual(["coded"]);
  });
});

describe("POST /api/member-badges/award", () => {
  beforeEach(() => {
    dataset = new InMemoryDataset({ badgeTypes: [type("manual"), type("coded", { is_automatic: true }), type("evt", { event_id: "evt-1" })] });
  });

  it("awards a badge, noting who gave it", async () => {
    const res = await award(json({ memberId: "mbr_1", badgeTypeId: "manual", occurredAt: "2026-04-01", note: " Thanks " }));

    expect(res.status).toBe(201);
    expect((await res.json()).memberBadge).toMatchObject({ memberId: "mbr_1", badgeTypeId: "manual", note: "Thanks", awardedBy: "admin-user" });
    expect(dataset.memberBadges).toHaveLength(1);
  });

  it("records no giver for the system", async () => {
    auth = { user: { id: "cron" } };

    await award(json({ memberId: "mbr_1", badgeTypeId: "manual" }));

    expect(dataset.memberBadges[0].awardedBy).toBeNull();
  });

  it("refuses an automatic badge, an event badge, an unknown one and missing fields", async () => {
    expect((await award(json({ memberId: "m", badgeTypeId: "coded" }))).status).toBe(400);
    expect((await award(json({ memberId: "m", badgeTypeId: "evt" }))).status).toBe(400);
    expect((await award(json({ memberId: "m", badgeTypeId: "missing" }))).status).toBe(404);
    expect((await award(json({ badgeTypeId: "manual" }))).status).toBe(400);
    expect(dataset.memberBadges).toEqual([]);
  });
});

describe("DELETE /api/member-badges/[id]", () => {
  it("revokes an award, except one that came from event attendance", async () => {
    dataset = new InMemoryDataset({
      memberBadges: [
        { id: "by-hand", memberId: "m", badgeTypeId: "manual", occurredAt: "2026-01-01", note: null, eventId: null, awardedBy: null },
        { id: "by-event", memberId: "m", badgeTypeId: "evt", occurredAt: "2026-01-01", note: null, eventId: "evt-1", awardedBy: null },
      ],
    });

    expect((await revoke(json({}), params("by-event"))).status).toBe(400);
    expect((await revoke(json({}), params("by-hand"))).status).toBe(200);
    expect(dataset.memberBadges.map((b) => b.id)).toEqual(["by-event"]);
  });
});
