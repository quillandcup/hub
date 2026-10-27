import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The create and update routes carry the "prickles" flag the Events page reads. A small recording
// client stands in for Supabase: it captures the written payload and answers "no name clash".

let written: Record<string, unknown> | undefined;
// The clash check answers "no other type has this name"; the write is captured.
const client = {
  from: () => ({
    select: () => ({ eq: () => ({ neq: () => ({ single: async () => ({ data: null }) }), single: async () => ({ data: null }) }) }),
    insert: (payload: Record<string, unknown>) => {
      written = payload;
      return { select: () => ({ single: async () => ({ data: { id: "prty_AAAAAAAAAAA1", ...payload }, error: null }) }) };
    },
    update: (payload: Record<string, unknown>) => {
      written = payload;
      return { eq: async () => ({ error: null }) };
    },
  }),
};
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: client }),
}));
const triggers = vi.hoisted(() => ({ recent: vi.fn(async () => {}), wide: vi.fn(async () => {}) }));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: triggers.recent, triggerPrickleTypeReprocessing: triggers.wide }));

import { POST as create } from "@/app/api/prickle-types/create/route";
import { POST as update } from "@/app/api/prickle-types/update/route";

const post = (route: (request: NextRequest) => Promise<Response>, body: unknown) =>
  route(new NextRequest("http://localhost/api/prickle-types", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  written = undefined;
  triggers.recent.mockClear();
  triggers.wide.mockClear();
});

describe("prickle type routes: dimensions", () => {
  it("stores each dimension when creating a type", async () => {
    const res = await post(create, { name: "Book Launch Party", listedInEvents: true, announcedPublicly: true, guestsAllowed: false });

    expect(res.status).toBe(201);
    expect(written).toMatchObject({ name: "Book Launch Party", listed_in_events: true, announced_publicly: true, guests_allowed: false });
  });

  it("stores each dimension when updating a type", async () => {
    const res = await post(update, { typeId: "prty_AAAAAAAAAAA1", name: "Pitch Prickle", listedInEvents: false, announcedPublicly: false, guestsAllowed: true });

    expect(res.status).toBe(200);
    expect(written).toMatchObject({ listed_in_events: false, announced_publicly: false, guests_allowed: true });
  });

  it("leaves dimensions alone when the request doesn't mention them", async () => {
    await post(update, { typeId: "prty_AAAAAAAAAAA1", name: "Pitch Prickle" });

    expect(written).not.toHaveProperty("listed_in_events");
    expect(written).not.toHaveProperty("announced_publicly");
    expect(written).not.toHaveProperty("guests_allowed");
  });

  it.each(["listedInEvents", "announcedPublicly", "guestsAllowed"])("rejects %s when it isn't a boolean", async (field) => {
    expect((await post(create, { name: "X", [field]: "yes" })).status).toBe(400);
    expect((await post(update, { typeId: "prty_AAAAAAAAAAA1", name: "X", [field]: 1 })).status).toBe(400);
    expect(written).toBeUndefined();
  });
});

describe("prickle type update route: default host, other names, guest speaker", () => {
  const typeId = "prty_AAAAAAAAAAA1";

  it("stores them, normalizing the other names, and rebuilds a year of prickles", async () => {
    const res = await post(update, { typeId, name: "Educational Prickle", defaultHostId: "mbr_AAAAAAAAAAA1", summaryAliases: [" EDU-Prickle ", "edu", "", "Learn"], namesGuestSpeaker: true });

    expect(res.status).toBe(200);
    expect(written).toMatchObject({ default_host_id: "mbr_AAAAAAAAAAA1", summary_aliases: ["edu", "learn"], names_guest_speaker: true });
    expect(triggers.wide).toHaveBeenCalledTimes(1);
    expect(triggers.recent).not.toHaveBeenCalled();
  });

  it("clears the default host with null", async () => {
    await post(update, { typeId, name: "Educational Prickle", defaultHostId: null });

    expect(written).toMatchObject({ default_host_id: null });
  });

  it("leaves them alone, and rebuilds only the recent window, when not mentioned", async () => {
    await post(update, { typeId, name: "Pitch Prickle" });

    expect(written).not.toHaveProperty("default_host_id");
    expect(written).not.toHaveProperty("summary_aliases");
    expect(written).not.toHaveProperty("names_guest_speaker");
    expect(triggers.recent).toHaveBeenCalledTimes(1);
    expect(triggers.wide).not.toHaveBeenCalled();
  });

  it.each([
    ["defaultHostId", "not-a-member"],
    ["summaryAliases", "edu"],
    ["summaryAliases", [1]],
    ["namesGuestSpeaker", "yes"],
  ])("rejects %s of %j", async (field, value) => {
    expect((await post(update, { typeId, name: "X", [field]: value })).status).toBe(400);
    expect(written).toBeUndefined();
  });
});
