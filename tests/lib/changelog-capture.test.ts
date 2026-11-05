import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANGELOG_ENTRIES, type ChangelogEntry } from "@/lib/changelog/entries";
import { CAPTURE_PROJECT, SCREENSHOT_MAX_WIDTH, captureDir, captureEntry, playwrightArgs, toCommittedScreenshot, captureProblem, capturedImages, entryImagePaths, missingImageFiles, publicDir, sceneFile } from "@/lib/changelog/capture";

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  slug: "a-thing",
  date: "2026-11-01",
  audience: "product",
  category: "new",
  title: "A thing",
  summary: "It does a thing.",
  body: "More.",
  ...over,
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "changelog-capture-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const touch = (...parts: string[]) => {
  const file = path.join(root, ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x");
};

describe("paths", () => {
  it("names the scene, the capture folder and the public folder from the slug", () => {
    expect(sceneFile("a-thing")).toBe("demo/scenes/changelog/a-thing.spec.ts");
    expect(captureDir("a-thing")).toBe(`demo/out/a-thing/${CAPTURE_PROJECT}`);
    expect(publicDir("a-thing", "/r")).toBe("/r/public/changelog/a-thing");
  });
});

describe("capturedImages", () => {
  it("lists the PNGs in order, leaving out the findings files and anything oddly named", () => {
    touch("out", "02-b.png");
    touch("out", "01-a.png");
    touch("out", "01-a.findings.json");
    touch("out", "Bad Name.png");
    expect(capturedImages(path.join(root, "out"))).toEqual(["01-a.png", "02-b.png"]);
  });

  it("is empty for a folder that does not exist", () => {
    expect(capturedImages(path.join(root, "nope"))).toEqual([]);
  });
});

describe("captureProblem", () => {
  it("says why a slug can't be captured, and null when it can", () => {
    expect(captureProblem("Bad Slug", [entry()], root)).toContain("not a changelog slug");
    expect(captureProblem("other", [entry()], root)).toContain("No changelog entry");
    expect(captureProblem("a-thing", [entry({ audience: "engineering" })], root)).toContain("engineering entry");
    expect(captureProblem("a-thing", [entry()], root)).toContain("No scene at");
    touch(sceneFile("a-thing"));
    expect(captureProblem("a-thing", [entry()], root)).toBeNull();
  });
});

describe("images an entry shows", () => {
  it("collects the list image and the body images once", () => {
    const e = entry({ image: { src: "/changelog/a-thing/one.png", alt: "x" }, body: "![a](/changelog/a-thing/one.png) ![b](/changelog/a-thing/two.png)" });
    expect(entryImagePaths(e)).toEqual(["/changelog/a-thing/one.png", "/changelog/a-thing/two.png"]);
  });

  it("reports the ones not in public/, for product entries only", () => {
    touch("public", "changelog", "a-thing", "one.png");
    const e = entry({ body: "![a](/changelog/a-thing/one.png) ![b](/changelog/a-thing/two.png)" });
    expect(missingImageFiles([e, entry({ slug: "eng", audience: "engineering" })], root)).toEqual(["a-thing: /changelog/a-thing/two.png"]);
  });
});

describe("the committed entries", () => {
  it("only show screenshots that exist in public/changelog", () => {
    expect(missingImageFiles(CHANGELOG_ENTRIES)).toEqual([]);
  });
});

describe("captureEntry", () => {
  const e = entry();
  const fakeConvert = async (png: Buffer) => Buffer.from(`webp:${png.toString()}`);
  const sceneThatTakes = (...files: string[]) => (args: string[]) => {
    expect(args).toEqual(playwrightArgs("a-thing"));
    for (const f of files) {
      const file = path.join(root, captureDir("a-thing"), f);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, f);
    }
    return 0;
  };

  it("runs the scene on the capture project for that entry's file, filtered to the changelog tag", () => {
    expect(playwrightArgs("a-thing")).toEqual([
      "exec", "playwright", "test", "--config", "demo/playwright.config.ts", "--project", CAPTURE_PROJECT, "--grep", "@changelog", "demo/scenes/changelog/a-thing.spec.ts",
    ]);
  });

  it("refuses without running when the entry or its scene is missing", async () => {
    let ran = false;
    const run = () => ((ran = true), 0);
    expect(await captureEntry("a-thing", run, { entries: [e], root })).toEqual({ ok: false, error: expect.stringContaining("No scene at") });
    expect(await captureEntry("nope", run, { entries: [e], root })).toEqual({ ok: false, error: expect.stringContaining("No changelog entry") });
    expect(ran).toBe(false);
  });

  it("writes the screenshots the scene took as WebP, replacing an earlier capture's images but not other files", async () => {
    touch(sceneFile("a-thing"));
    touch("public", "changelog", "a-thing", "old.png");
    touch("public", "changelog", "a-thing", "older.webp");
    touch("public", "changelog", "a-thing", "notes.txt");
    touch("demo", "out", "a-thing", CAPTURE_PROJECT, "stale.png"); // from an earlier run: cleared before this one
    const result = await captureEntry("a-thing", sceneThatTakes("01-first.png", "02-second.png", "01-first.findings.json"), { entries: [e], root, convert: fakeConvert });
    expect(result).toEqual({ ok: true, copied: ["01-first.webp", "02-second.webp"], target: publicDir("a-thing", root) });
    expect(readdirSync(publicDir("a-thing", root)).sort()).toEqual(["01-first.webp", "02-second.webp", "notes.txt"]);
    expect(readFileSync(path.join(publicDir("a-thing", root), "01-first.webp"), "utf8")).toBe("webp:01-first.png");
  });

  it("writes nothing when the scene fails or takes no screenshots", async () => {
    touch(sceneFile("a-thing"));
    touch("public", "changelog", "a-thing", "keep.webp");
    expect(await captureEntry("a-thing", () => 1, { entries: [e], root })).toEqual({ ok: false, error: expect.stringContaining("exit 1") });
    expect(await captureEntry("a-thing", () => 0, { entries: [e], root })).toEqual({ ok: false, error: expect.stringContaining("no screenshots") });
    expect(readdirSync(publicDir("a-thing", root))).toEqual(["keep.webp"]);
  });
});

describe("toCommittedScreenshot", () => {
  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 160 } } })
      .composite([{ input: { create: { width: Math.floor(width / 2), height: Math.floor(height / 2), channels: 3, background: { r: 20, g: 20, b: 60 } } }, top: 10, left: 10 }])
      .png()
      .toBuffer();

  it("makes a WebP no wider than the limit, much smaller than the PNG, keeping the proportions", async () => {
    const source = await png(2400, 1200);
    const out = await toCommittedScreenshot(source);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([SCREENSHOT_MAX_WIDTH, 600]);
    expect(out.length).toBeLessThan(source.length);
  });

  it("never enlarges a small screenshot", async () => {
    const meta = await sharp(await toCommittedScreenshot(await png(800, 500))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 800, 500]);
  });
});
