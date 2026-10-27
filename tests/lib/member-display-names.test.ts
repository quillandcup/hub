import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The community knows a member by their display name (getMemberDisplayName), not their legal name,
// and admin pages show it too (with the legal name beside it where identity matters). A host's
// `.name` is that bug waiting to happen: a host shown as "Laura May Best" when she goes by "Bestie".
// This fails on a new one; read the name through getMemberDisplayName, or, when the code only maps
// rows or is a billing/matching tool that needs the legal name, list the file here.

const ROOT = path.resolve(__dirname, "../..");
const SCAN = ["app", "components", "lib"];
const SKIP_DIRS = [path.join("lib", "data", "database.types.ts")];

// Files that read `host.name` on purpose, each with the reason.
const ALLOWED: Record<string, string> = {
  "lib/data/prickles.ts": "the repository: maps the row to { name, displayName }",
  "lib/attendance-view.ts": "maps the repository's host to a row with display_name beside name",
  "lib/prickle-schedule.ts": "maps the host to { name, display_name } for getMemberDisplayName",
  "lib/prickle-picker.ts": "its hosts come from the picker action, already by display name",
};

const HOST_NAME = /\bhost\??\.name\b|\bhostInfo\??\.name\b/;
const HANDLES_DISPLAY = /getMemberDisplayName|display_name|displayName/;

function sourceFiles(dir: string): string[] {
  const rel = path.relative(ROOT, dir);
  if (SKIP_DIRS.includes(rel)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !SKIP_DIRS.includes(path.relative(ROOT, full)) ? [full] : [];
  });
}

describe("member-facing code names hosts by display name", () => {
  const offenders = SCAN.flatMap((d) => sourceFiles(path.join(ROOT, d)))
    .map((file) => path.relative(ROOT, file))
    .filter((rel) => !(rel in ALLOWED))
    .flatMap((rel) =>
      fs
        .readFileSync(path.join(ROOT, rel), "utf8")
        .split("\n")
        .map((line, i) => ({ rel, line, n: i + 1 }))
        .filter(({ line }) => HOST_NAME.test(line) && !HANDLES_DISPLAY.test(line))
        .map(({ rel, n, line }) => `${rel}:${n}  ${line.trim()}`)
    );

  it("reads no host's legal name outside the allowlist", () => {
    expect(offenders).toEqual([]);
  });

  it("allowlists only files that still read a host's name", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => !HOST_NAME.test(fs.readFileSync(path.join(ROOT, rel), "utf8")));
    expect(stale).toEqual([]);
  });
});
