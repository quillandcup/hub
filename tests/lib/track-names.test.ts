import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TRACK_NAME, navTrackName, trackSlug } from "@/lib/analytics/names";

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : sourceFiles(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe("data-track names in the source", () => {
  const root = path.resolve(__dirname, "../..");
  const found = ["app", "components"].flatMap((dir) =>
    sourceFiles(path.join(root, dir)).flatMap((file) =>
      [...fs.readFileSync(file, "utf8").matchAll(/data-track="([^"]*)"/g)].map((m) => ({ file: path.relative(root, file), name: m[1] }))
    )
  );

  it("finds the named controls", () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it.each(found.map((f) => [f.name, f.file]))("%s (%s) is lower-case kebab-case", (name) => {
    expect(name).toMatch(TRACK_NAME);
    expect(name.length).toBeLessThanOrEqual(80);
  });

  it("never names a control after a person or an address", () => {
    for (const { name } of found) expect(name).not.toMatch(/@/);
  });
});

describe("trackSlug / navTrackName", () => {
  it.each([
    ["/", "home"],
    ["/dashboard", "dashboard"],
    ["/my-prickles/all", "my-prickles-all"],
    ["/settings/notifications?x=1#y", "settings-notifications"],
    ["/Wheel_of Wonder", "wheel-of-wonder"],
    ["", "home"],
  ])("%j -> %s", (path, slug) => {
    expect(trackSlug(path)).toBe(slug);
    expect(navTrackName(path)).toBe(`nav-${slug}`);
    expect(navTrackName(path)).toMatch(TRACK_NAME);
  });
});
