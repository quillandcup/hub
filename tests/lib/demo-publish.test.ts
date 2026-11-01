import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { missingImages, publishPlan, referencedImages, setsToPrune } from "@/demo/publish";

describe("publishPlan", () => {
  let out: string;
  const put = (...parts: string[]) => {
    const file = path.join(out, ...parts);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "x");
  };
  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), "demo-out-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it("publishes the desktop light screenshots under their scene, in order", () => {
    put("join-a-prickle", "desktop-light", "02-on-air-popover.png");
    put("join-a-prickle", "desktop-light", "01-dashboard.png");
    expect(publishPlan(out).map((u) => u.remote)).toEqual(["join-a-prickle/01-dashboard.png", "join-a-prickle/02-on-air-popover.png"]);
  });

  it("leaves out the other sizes and themes, and files the image route would refuse", () => {
    put("join-a-prickle", "phone-dark", "01-dashboard.png");
    put("join-a-prickle", "desktop-dark", "01-dashboard.png");
    put("join-a-prickle", "desktop-light", "notes.txt");
    put("join-a-prickle", "desktop-light", "Has Spaces.png");
    expect(publishPlan(out)).toEqual([]);
  });

  it("with a list of wanted images, publishes only those", () => {
    put("join-a-prickle", "desktop-light", "01-dashboard.png");
    put("read-the-help", "desktop-light", "01-help-index.png");
    expect(publishPlan(out, new Set(["join-a-prickle/01-dashboard.png"])).map((u) => u.remote)).toEqual(["join-a-prickle/01-dashboard.png"]);
  });

  it("reads the wanted images from the articles, so every screenshot an article shows is published", () => {
    const wanted = referencedImages();
    expect(wanted.has("join-a-prickle/01-dashboard.png")).toBe(true);
    expect(wanted.has("plan-your-month/03-commitments.png")).toBe(true);
    expect([...wanted].every((ref) => !ref.startsWith("read-the-help/"))).toBe(true);
  });

  it("plans nothing before any capture exists", () => {
    expect(publishPlan(path.join(out, "missing"))).toEqual([]);
  });
});

describe("missingImages", () => {
  const plan = [
    { local: "a", remote: "scene/01-a.png" },
    { local: "b", remote: "scene/02-b.png" },
  ];

  it("lists what an article shows that no scene captured, sorted", () => {
    expect(missingImages(plan, new Set(["scene/02-b.png", "scene/09-gone.png", "other/01-x.png"]))).toEqual(["other/01-x.png", "scene/09-gone.png"]);
  });

  it("is empty when every wanted screenshot was captured, even if more were", () => {
    expect(missingImages(plan, new Set(["scene/01-a.png"]))).toEqual([]);
  });

  it("holds for the real articles against the real scenes' steps once captured", () => {
    // With nothing captured, every referenced screenshot is reported (the CI check fails loudly, not silently).
    expect(missingImages([], referencedImages()).length).toBe(referencedImages().size);
  });
});

describe("setsToPrune", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  const sets = [
    { name: "fresh", newest: now - 1 * DAY },
    { name: "recent", newest: now - 29 * DAY },
    { name: "old1", newest: now - 31 * DAY },
    { name: "old2", newest: now - 40 * DAY },
    { name: "old3", newest: now - 90 * DAY },
  ];

  it("deletes sets past the window, keeping the newest of them for deploys from before it", () => {
    expect(setsToPrune(sets, 30, "fresh", now).sort()).toEqual(["old2", "old3"]);
  });

  it("deletes nothing while every set is inside the window, or when there are none", () => {
    expect(setsToPrune(sets, 365, "fresh", now)).toEqual([]);
    expect(setsToPrune([], 30, "x", now)).toEqual([]);
  });

  it("never deletes the set being published, even when its files look old", () => {
    expect(setsToPrune(sets, 30, "old3", now).sort()).toEqual(["old2"]);
  });
});
