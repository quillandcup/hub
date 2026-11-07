import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => createInMemoryRepos(dataset),
}));

import { copySlackAvatars } from "@/lib/chat/avatar-copy";
import { avatarPublicUrl, slackPhotoUrl, SLACK_AVATAR_BUCKET } from "@/lib/slack-avatar-url";

const objects = new Map<string, Buffer>();
let uploadError: string | null = null;
const storage = {
  storage: {
    from: (bucket: string) => {
      expect(bucket).toBe(SLACK_AVATAR_BUCKET);
      return {
        upload: async (path: string, bytes: Buffer) => {
          if (uploadError) return { error: { message: uploadError } };
          objects.set(path, bytes);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) objects.delete(p);
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      };
    },
  },
} as never;

let png: Buffer;
const answer = (bytes: Buffer | string, status = 200) => async () => new Response(new Uint8Array(Buffer.from(bytes)), { status });
const users = () => createInMemoryRepos(dataset).slackUsers;

beforeEach(async () => {
  objects.clear();
  uploadError = null;
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  dataset = new InMemoryDataset({
    slackUsers: [
      { user_id: "U1", image_url: "https://slack.test/u1.png" },
      { user_id: "U2", image_url: "https://slack.test/u2.png", is_deleted: true },
      { user_id: "U3" },
    ],
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("copySlackAvatars", () => {
  it("copies a live user's photo under their id and the content hash, and serves our copy from then on", async () => {
    expect(await copySlackAvatars(storage, vi.fn(answer(png)) as unknown as typeof fetch)).toEqual({ copied: 1, failed: 0, removed: 0 });

    const u1 = await users().byId("U1");
    expect(u1?.image_path).toMatch(/^U1\/[0-9a-f]{32}\.png$/);
    expect(objects.has(u1!.image_path!)).toBe(true);
    expect(slackPhotoUrl(storage, u1!)).toBe(avatarPublicUrl(storage, u1!.image_path!));
    expect(slackPhotoUrl(storage, (await users().byId("U3"))!)).toBeNull();
    expect((await users().byId("U2"))?.image_path).toBeNull();

    // Idempotent: nothing left to copy.
    const again = vi.fn();
    expect(await copySlackAvatars(storage, again as unknown as typeof fetch)).toEqual({ copied: 0, failed: 0, removed: 0 });
    expect(again).not.toHaveBeenCalled();
  });

  it("falls back to Slack's address until a photo is copied", async () => {
    expect(slackPhotoUrl(storage, (await users().byId("U1"))!)).toBe("https://slack.test/u1.png");
  });

  it("replaces the copy when the photo changes, and removes the old object", async () => {
    await copySlackAvatars(storage, vi.fn(answer(png)) as unknown as typeof fetch);
    const old = (await users().byId("U1"))!.image_path!;

    const other = await sharp({ create: { width: 5, height: 5, channels: 3, background: "#000" } }).png().toBuffer();
    await users().upsert([{ user_id: "U1", image_url: "https://slack.test/u1-v2.png", raw_payload: {} }]);
    expect(await copySlackAvatars(storage, vi.fn(answer(other)) as unknown as typeof fetch)).toMatchObject({ copied: 1 });

    const next = (await users().byId("U1"))!.image_path!;
    expect(next).not.toBe(old);
    expect(objects.has(old)).toBe(false);
    expect(objects.has(next)).toBe(true);
  });

  it("removes the copy of a user who was deactivated or took the photo down", async () => {
    await copySlackAvatars(storage, vi.fn(answer(png)) as unknown as typeof fetch);
    const path = (await users().byId("U1"))!.image_path!;
    await users().upsert([{ user_id: "U1", is_deleted: true, raw_payload: {} }]);

    expect(await copySlackAvatars(storage, vi.fn() as unknown as typeof fetch)).toEqual({ copied: 0, failed: 0, removed: 1 });
    expect(objects.has(path)).toBe(false);
    expect((await users().byId("U1"))?.image_path).toBeNull();
  });

  it("leaves a user on Slack's address when the photo can't be fetched, isn't an image, is too big, or can't be stored", async () => {
    expect(await copySlackAvatars(storage, vi.fn(answer("", 404)) as unknown as typeof fetch)).toEqual({ copied: 0, failed: 1, removed: 0 });
    expect(await copySlackAvatars(storage, vi.fn(answer("not an image")) as unknown as typeof fetch)).toMatchObject({ failed: 1 });
    expect(await copySlackAvatars(storage, vi.fn(answer(Buffer.alloc(3 * 1024 * 1024))) as unknown as typeof fetch)).toMatchObject({ failed: 1 });
    uploadError = "bucket full";
    expect(await copySlackAvatars(storage, vi.fn(answer(png)) as unknown as typeof fetch)).toMatchObject({ copied: 0, failed: 1 });
    expect((await users().byId("U1"))?.image_path).toBeNull();

    // The next run tries again.
    uploadError = null;
    expect(await copySlackAvatars(storage, vi.fn(answer(png)) as unknown as typeof fetch)).toMatchObject({ copied: 1 });
  });

  it("refuses an address that isn't https and an id that isn't a Slack id", async () => {
    dataset = new InMemoryDataset({ slackUsers: [{ user_id: "U1", image_url: "http://slack.test/u1.png" }, { user_id: "../x", image_url: "https://slack.test/x.png" }] });
    const fetchImage = vi.fn();
    expect(await copySlackAvatars(storage, fetchImage as unknown as typeof fetch)).toEqual({ copied: 0, failed: 2, removed: 0 });
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
