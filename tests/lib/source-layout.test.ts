import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The application code lives under src/ (app, components, lib, emails, content, and the proxy and instrumentation files);
// public/, config/, docs/, scripts/, supabase/ and tests/ stay at the root. Next.js needs `public/` at the root and the
// proxy and instrumentation files next to `app` once there is a src folder.
const ROOT = path.resolve(__dirname, "../..");
const MOVED = ["app", "components", "lib", "emails", "content"];
const MOVED_FILES = ["proxy.ts", "instrumentation.ts", "instrumentation-client.ts"];

// Text that keeps the paths it was written with: history (what a doc or a migration said then), and fingerprints
// of old commits. Everything else must name the current paths.
const HISTORIC = [/^supabase\/migrations\//, /^docs\/decisions\//, /^docs\/superpowers\//, /^pnpm-lock\.yaml$/, /^config\/\.gitleaksignore$/, /^\.claude\/settings\.local\.json$/, /^tests\/lib\/source-layout\.test\.ts$/];
// Coverage areas are still named without src/ (`app/api`, `lib`, `components`: the keys of AREA_FLOORS in scripts/coverage-report.ts).
const AREA_NAMES = [/^scripts\/coverage-report\.ts$/, /^tests\/lib\/coverage-report\.test\.ts$/, /^\.github\/workflows\/ci\.yml$/];
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|mp4|mp3|wav|pdf|zip|csv)$/i;

const tracked = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString()
    .split("\0")
    .filter((f) => f && !BINARY.test(f) && !HISTORIC.some((re) => re.test(f)) && !AREA_NAMES.some((re) => re.test(f)) && existsSync(path.join(ROOT, f)));

/** A repo path `lib/...` (not `tests/lib/...`, `@/lib/...` or `../lib/...`), cut where a glob, ellipsis or punctuation starts. */
const OLD_ROOT = new RegExp(`(?<![\\w./@~-])(?:${MOVED.join("|")})/[\\w()\\[\\].-]*(?:/[\\w()\\[\\].-]+)*`, "g");
const OLD_ROOT_FILE = new RegExp(`(?<![\\w./@~-])(?:${MOVED_FILES.map((f) => f.replace(".", "\\.")).join("|")})(?![\\w-])`, "g");

/** Mentions of a path that exists under src/ but is written as if it were still at the root. */
export function staleMentions(text: string, existsUnderSrc: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(OLD_ROOT)) {
    const mention = match[0].replace(/[.]+$/, "");
    if (existsUnderSrc(mention)) out.push(mention);
  }
  for (const match of text.matchAll(OLD_ROOT_FILE)) {
    if (existsUnderSrc(match[0])) out.push(match[0]);
  }
  return out;
}

describe("source layout", () => {
  it("keeps the application folders under src/ and the root folders where they were", () => {
    for (const dir of MOVED) expect(existsSync(path.join(ROOT, "src", dir)), `src/${dir}`).toBe(true);
    for (const dir of MOVED) expect(existsSync(path.join(ROOT, dir)), `${dir} at the root`).toBe(false);
    for (const file of MOVED_FILES) {
      expect(existsSync(path.join(ROOT, "src", file)), `src/${file}`).toBe(true);
      expect(existsSync(path.join(ROOT, file)), `${file} at the root`).toBe(false);
    }
    for (const dir of ["public", "config", "docs", "scripts", "supabase", "tests"]) expect(existsSync(path.join(ROOT, dir)), dir).toBe(true);
  });

  it("points `@/` at src/, with the three root folders tests and app code also import by it", () => {
    const { compilerOptions } = JSON.parse(readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")) as { compilerOptions: { paths: Record<string, string[]> } };
    expect(compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    expect(Object.keys(compilerOptions.paths).sort()).toEqual(["@/*", "@/config/*", "@/scripts/*", "@/tests/*"]);
  });

  it("flags a path written as it was before the move, and leaves look-alikes alone", () => {
    const under = (p: string) => existsSync(path.join(ROOT, "src", p));
    expect(staleMentions("see `lib/config.ts` and app/(member)/chat", under)).toEqual(["lib/config.ts", "app/(member)/chat"]);
    expect(staleMentions("`components/` and content/help/ and proxy.ts", under)).toEqual(["components/", "content/help", "proxy.ts"]);
    expect(staleMentions("src/lib/config.ts, tests/lib/x.ts, @/lib/config, ../lib/config, scripts/lib, /app/api", under)).toEqual([]);
    expect(staleMentions("the web app/mobile split, lib/no-such-file.ts, tests/lib/proxy-x.test.ts", under)).toEqual([]);
  });

  it("has no tracked file naming a moved path as it was at the root", () => {
    const under = (p: string) => existsSync(path.join(ROOT, "src", p));
    const stale: string[] = [];
    for (const file of tracked()) {
      for (const mention of new Set(staleMentions(readFileSync(path.join(ROOT, file), "utf8"), under))) stale.push(`${file}: ${mention}`);
    }
    expect(stale, "write the path with src/ in front (history snapshots are listed in HISTORIC)").toEqual([]);
  });
});
