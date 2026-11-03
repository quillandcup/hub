import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { animatedGif, bouncingDisc, DISC_PALETTE } from "../../demo/gif";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => createInMemoryRepos(dataset),
}));

import { copyEmojiImages } from "@/lib/chat/emoji-copy";
import { emojiPublicUrl, SLACK_EMOJI_BUCKET } from "@/lib/chat/emoji-url";

const uploads = new Map<string, Buffer>();
let uploadError: string | null = null;
const storage = {
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Buffer) => {
        expect(bucket).toBe(SLACK_EMOJI_BUCKET);
        if (uploadError) return { error: { message: uploadError } };
        uploads.set(path, bytes);
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
    }),
  },
} as never;

const gif = animatedGif(16, DISC_PALETTE, bouncingDisc(16), 100);
let png: Buffer;
const answer = (bytes: Buffer, status = 200) => async () => new Response(new Uint8Array(bytes), { status });

beforeEach(async () => {
  uploads.clear();
  uploadError = null;
  dataset = new InMemoryDataset({
    slackCustomEmoji: [
      { name: "dance", image_url: "https://slack.test/dance.gif" },
      { name: "flat", image_url: "https://slack.test/flat.png" },
      { name: "hog", alias_for: "dance" },
    ],
  });
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("copyEmojiImages", () => {
  it("copies each image, with a still of the first frame for an animated one only, and records the paths", async () => {
    const fetchImage = vi.fn(async (url: string | URL | Request) => String(url).endsWith(".gif") ? answer(gif)() : answer(png)()) as unknown as typeof fetch;
    expect(await copyEmojiImages(storage, fetchImage)).toEqual({ copied: 2, failed: 0 });

    const rows = await createInMemoryRepos(dataset).slackWorkspace.emojiByNames(["dance", "flat", "hog"]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.dance.image_path).toMatch(/^[0-9a-f]{32}\.gif$/);
    expect(by.dance.still_path).toMatch(/^[0-9a-f]{32}\.still\.png$/);
    expect(by.flat.image_path).toMatch(/\.png$/);
    expect(by.flat.still_path).toBeNull();
    expect(by.hog.image_path).toBeNull();
    // The still is a single-frame PNG.
    const still = await sharp(uploads.get(by.dance.still_path!)).metadata();
    expect([still.format, still.pages ?? 1]).toEqual(["png", 1]);
    expect(emojiPublicUrl(storage, "x.png")).toBe(`https://cdn.test/${SLACK_EMOJI_BUCKET}/x.png`);
  });

  it("copies nothing on a second run, and again when the emoji's image changes", async () => {
    const fetchImage = vi.fn(answer(png)) as unknown as typeof fetch;
    await copyEmojiImages(storage, fetchImage);
    expect(await copyEmojiImages(storage, fetchImage)).toEqual({ copied: 0, failed: 0 });
    await createInMemoryRepos(dataset).slackWorkspace.upsertEmoji([{ name: "flat", image_url: "https://slack.test/flat2.png" }]);
    expect(await copyEmojiImages(storage, fetchImage)).toEqual({ copied: 1, failed: 0 });
  });

  it("counts a failure, keeps going, and tries that emoji again next run", async () => {
    const fetchImage = vi.fn(async (url: string | URL | Request) => (String(url).includes("dance") ? answer(Buffer.from("x"), 404)() : answer(png)())) as unknown as typeof fetch;
    expect(await copyEmojiImages(storage, fetchImage)).toEqual({ copied: 1, failed: 1 });
    expect((await createInMemoryRepos(dataset).slackWorkspace.emojiToCopy()).map((e) => e.name)).toEqual(["dance"]);
  });

  it("fails an emoji that is not an image, is empty, is not https or can't be stored", async () => {
    dataset = new InMemoryDataset({ slackCustomEmoji: [{ name: "text", image_url: "https://slack.test/a.png" }, { name: "empty", image_url: "https://slack.test/b.png" }, { name: "http", image_url: "http://slack.test/c.png" }] });
    const fetchImage = vi.fn(async (url: string | URL | Request) => (String(url).includes("b.png") ? answer(Buffer.alloc(0))() : answer(Buffer.from("not an image"))())) as unknown as typeof fetch;
    expect(await copyEmojiImages(storage, fetchImage)).toEqual({ copied: 0, failed: 3 });

    dataset = new InMemoryDataset({ slackCustomEmoji: [{ name: "flat", image_url: "https://slack.test/flat.png" }] });
    uploadError = "bucket missing";
    expect(await copyEmojiImages(storage, answer(png) as unknown as typeof fetch)).toEqual({ copied: 0, failed: 1 });
  });
});
