import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishPlan, referencedImages } from "@/demo/publish";

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
