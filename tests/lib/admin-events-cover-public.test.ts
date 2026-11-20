import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { eventSeed } from "@/tests/helpers/event-fixtures";

/**
 * An event's cover is shown to signed-out visitors in the landing pages' Coming up only when its asset is public, so saving a publicly
 * announced event with a cover marks the cover public (the way publishing a landing page marks its pictures), and nothing else does.
 */
let repos = createInMemoryRepos();
let data = new InMemoryDataset();
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: async () => ({ user: { id: "admin" }, supabase: {} }) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { POST as create } from "@/app/api/admin/events/route";
import { PATCH as update } from "@/app/api/admin/events/[id]/route";

const EVENT_TYPE = { id: "prty_EVENTONLY001", name: "Event", normalizedName: "event", purpose: "social", requiresHost: false, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: false, guestsAllowed: false };
const BASE = { slug: "open-house", title: "Open House", event_type: "workshop", starts_at: "2097-05-01", ends_at: "2097-05-02" };
const ID = "evt_AAAAAAAAAAA1";
const post = (body: unknown) => create(new NextRequest("http://localhost/api/admin/events", { method: "POST", body: JSON.stringify(body) }));
const patch = (body: unknown) => update(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const image = { storage_path: "originals/shared/a.png", mime_type: "image/png", width: 1600, height: 900, bytes: 1, sha256: "a", title: "Cover" };

beforeEach(() => {
  data = new InMemoryDataset({ prickleTypes: [EVENT_TYPE] });
  repos = createInMemoryRepos(data);
});

describe("creating an event", () => {
  it("marks the cover public when the event is announced publicly", async () => {
    const asset = await repos.media.add(image);
    const res = await post({ ...BASE, announced_publicly: true, image_id: asset.id });
    expect(res.status).toBe(201);
    expect((await repos.media.byId(asset.id))?.is_public).toBe(true);
  });

  it("leaves the cover private when the event is for members only", async () => {
    const asset = await repos.media.add(image);
    expect((await post({ ...BASE, image_id: asset.id })).status).toBe(201);
    expect((await repos.media.byId(asset.id))?.is_public).toBe(false);
  });
});

describe("editing an event", () => {
  const seeded = (over: Record<string, unknown> = {}) => {
    data = new InMemoryDataset({ ...eventSeed([{ id: ID, slug: "retreat", title: "Retreat", ...over }]), prickleTypes: [EVENT_TYPE] } as never);
    repos = createInMemoryRepos(data);
  };

  it("marks a newly chosen cover public on an event that is already announced publicly", async () => {
    seeded({ announced_publicly: true });
    const asset = await repos.media.add(image);
    expect((await patch({ image_id: asset.id })).status).toBe(200);
    expect((await repos.media.byId(asset.id))?.is_public).toBe(true);
  });

  it("marks the cover public when an event with a cover is announced publicly", async () => {
    seeded();
    const asset = await repos.media.add(image);
    (data.events.find((e) => e.id === ID) as { image_id: string | null }).image_id = asset.id;
    expect(asset.is_public).toBe(false);
    expect((await patch({ announced_publicly: true })).status).toBe(200);
    expect((await repos.media.byId(asset.id))?.is_public).toBe(true);
  });

  it("does nothing to a cover on an event that stays members only, and still saves", async () => {
    seeded();
    const asset = await repos.media.add(image);
    expect((await patch({ image_id: asset.id, focus: "Craft" })).status).toBe(200);
    expect((await repos.media.byId(asset.id))?.is_public).toBe(false);
  });
});
